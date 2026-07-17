import { createError, defineEventHandler, getHeader, getRequestIP, readMultipartFormData } from "h3"
import { and, count, eq, gte, sql } from "drizzle-orm"
import { randomUUID } from "node:crypto"
import { LogsAttachment, MediaMetaEntry, ReportIntakeInput } from "@reprojs/shared"
import { db } from "../../db"
import { githubIntegrations, projects, reports, reportAttachments } from "../../db/schema"
import {
  applyIntakePostCors,
  applyIntakePreflightCors,
  isOriginAllowed,
} from "../../lib/intake-cors"
import { enqueueSync } from "../../lib/enqueue-sync"
import { env } from "../../lib/env"
import { getAnonKeyLimiter, getIpLimiter, getKeyLimiter } from "../../lib/rate-limit"
import { getStorage } from "../../lib/storage"
import { scanBytes } from "../../lib/clamav"
import { sanitizeFilename } from "../../lib/sanitize-filename"
import { rollbackPuts } from "../../lib/storage/rollback"

const DENIED_USER_FILE_MIMES = new Set([
  "application/x-msdownload",
  "application/x-sh",
  "text/x-shellscript",
  "application/x-executable",
])
const DENIED_USER_FILE_EXTS = [".exe", ".bat", ".cmd", ".com", ".scr", ".sh", ".ps1", ".vbs"]

// Gallery media (`media[N]` + `mediaMeta`) — screenshots + trimmed
// recordings from the SDK's own capture/annotation flow, distinct from
// arbitrary user-picked `attachment[N]` files.
const MEDIA_PART_RE = /^media\[(\d+)\]$/
const ALLOWED_MEDIA_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "video/webm",
  "video/mp4",
])
const MEDIA_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "video/webm": "webm",
  "video/mp4": "mp4",
}
// clamd's default StreamMaxLength (25 MB). Media parts above this are stored
// unscanned (scanStatus: "skipped-size") rather than fail-closed rejected —
// the mime allowlist is the primary control for large video parts. See
// task-10 brief for rationale.
const CLAMAV_STREAM_CEILING = 26_214_400

export default defineEventHandler(async (event) => {
  // Preflight reflects Origin so browsers can proceed with the real POST.
  // No response body reads happen on preflight, so this is safe.
  if (event.method === "OPTIONS") {
    applyIntakePreflightCors(event)
    event.node.res.statusCode = 204
    return ""
  }

  if (event.method !== "POST") {
    throw createError({ statusCode: 405, statusMessage: "Method not allowed" })
  }

  const rawOrigin = getHeader(event, "origin") ?? ""
  // When an extension service worker posts on behalf of a tester, the
  // browser sets Origin to chrome-extension://<id> — unforgeable from
  // a regular webpage. In that narrow case, fall back to the page origin
  // the extension captured client-side and forwarded via X-Repro-Origin.
  // Regular JS in a page cannot set a chrome-extension:// Origin, so this
  // fallback is only reachable from an installed extension, which is a
  // much higher bar than the standard leaked-project-key threat the
  // Origin allowlist is meant to defend against.
  // If rawOrigin is empty (mobile/Expo — no browser-set Origin), leave
  // origin as "" and defer the allow/reject decision until after parsing,
  // where we can check parsed.context.source.
  const origin =
    rawOrigin.length > 0 && rawOrigin.startsWith("chrome-extension://")
      ? (getHeader(event, "x-repro-origin") ?? "")
      : rawOrigin
  // TRUST_XFF is OFF by default — a public deployment must not be trivially
  // rate-limit-bypassed via a spoofed X-Forwarded-For header.
  const ip = getRequestIP(event, { xForwardedFor: env.TRUST_XFF }) ?? "unknown"

  let parts: Awaited<ReturnType<typeof readMultipartFormData>>
  try {
    parts = await readMultipartFormData(event)
  } catch {
    throw createError({ statusCode: 400, statusMessage: "Invalid multipart body" })
  }
  if (!parts) {
    throw createError({ statusCode: 400, statusMessage: "Expected multipart/form-data" })
  }
  const totalBytes = parts.reduce((n, p) => n + (p.data?.length ?? 0), 0)
  if (totalBytes > env.INTAKE_MAX_BYTES) {
    throw createError({ statusCode: 413, statusMessage: "Payload too large" })
  }

  const reportPart = parts.find((p) => p.name === "report")
  if (!reportPart) {
    throw createError({ statusCode: 400, statusMessage: "Missing 'report' part" })
  }

  let parsed: ReturnType<typeof ReportIntakeInput.parse>
  try {
    parsed = ReportIntakeInput.parse(JSON.parse(reportPart.data.toString("utf8")))
  } catch (err) {
    // Log the zod issues server-side so SDK authors can see exactly which field failed.
    // Safe to log at warn level — payloads that reach here have already passed origin +
    // project-key checks, so they're from legit callers submitting malformed shapes.
    const issues =
      err && typeof err === "object" && "issues" in err
        ? (err as { issues: unknown }).issues
        : String(err)
    console.warn("[intake] invalid report payload", JSON.stringify(issues, null, 2))
    throw createError({
      statusCode: 400,
      statusMessage: "Invalid report payload",
      data: { issues },
    })
  }

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.publicKey, parsed.projectKey))
    .limit(1)
  if (!project || project.deletedAt) {
    throw createError({ statusCode: 401, statusMessage: "Invalid project key" })
  }

  const idempotencyKey = getHeader(event, "idempotency-key") ?? null

  // Origin allowlist MUST be checked before the rate limiter takes, otherwise
  // an attacker with just a leaked project key can burn the legitimate SDK's
  // quota from any origin (including origins not on the allowlist).
  // For Expo (mobile) callers there is no browser-set Origin — allow empty
  // origin only when parsed.context.source === "expo".
  const allowEmptyOrigin = parsed.context.source === "expo"
  if (!isOriginAllowed(origin, project.allowedOrigins, { allowEmpty: allowEmptyOrigin })) {
    // Deliberately do NOT emit ACAO here — cross-origin scripts cannot read
    // this 403 body, which removes the cross-origin enumeration oracle.
    throw createError({ statusCode: 403, statusMessage: "Origin not allowed" })
  }

  // Origin validated: emit ACAO so the legitimate SDK (on this allowed origin)
  // can read both success AND error bodies of the rest of this request.
  // Use the RAW origin for CORS — the browser checks ACAO against the fetch
  // client's actual origin, which for an extension SW proxy is
  // chrome-extension://<id>, not the page-origin fallback we accepted above.
  // For Expo (no browser), rawOrigin is empty — skip ACAO entirely.
  if (rawOrigin) {
    applyIntakePostCors(event, rawOrigin)
  }

  // Idempotency short-circuit: if a client replays a request with the same
  // Idempotency-Key for this project, return the existing report id without
  // re-inserting. This runs BEFORE honeypot/dwell gates so legitimate mobile
  // retries always get a stable response even if those gates would reject.
  if (idempotencyKey) {
    const [existing] = await db
      .select({ id: reports.id })
      .from(reports)
      .where(and(eq(reports.projectId, project.id), eq(reports.idempotencyKey, idempotencyKey)))
      .limit(1)
    if (existing) {
      event.node.res.statusCode = 200
      return { id: existing.id }
    }
  }

  // S1: Honeypot check BEFORE rate-limit takes. Bots that set _hp must not
  // consume quota — tarpit them cheaply without burning the project's budget.
  if (parsed._hp && parsed._hp.length > 0) {
    // Tarpit: look successful to the attacker so they don't switch tactics.
    // Fake UUID, no DB write, no enqueue.
    event.node.res.statusCode = 201
    return { id: randomUUID() }
  }

  // S2: Require _dwellMs to be present and above the minimum. Bots that omit
  // the field entirely are now rejected. Opt-out via INTAKE_REQUIRE_DWELL=false
  // during SDK rollout to avoid breaking older SDK versions.
  if (
    env.INTAKE_REQUIRE_DWELL &&
    (parsed._dwellMs === undefined || parsed._dwellMs < env.INTAKE_MIN_DWELL_MS)
  ) {
    throw createError({ statusCode: 400, statusMessage: "Submission too fast" })
  }

  // P4: Fetch both limiters and fire both takes in parallel to halve the
  // round-trip count when RATE_LIMIT_STORE=postgres.
  const isAnon = !parsed.context.reporter?.userId
  const keyLimiter = await (isAnon ? getAnonKeyLimiter() : getKeyLimiter())
  const ipLimiter = await getIpLimiter()
  const [keyTake, ipTake] = await Promise.all([
    keyLimiter.take(`${isAnon ? "anon" : "key"}:${project.id}:${parsed.context.source}`),
    ipLimiter.take(`ip:${ip}`),
  ])
  if (!keyTake.allowed || !ipTake.allowed) {
    const retryAfterMs = Math.max(
      keyTake.allowed ? 0 : keyTake.retryAfterMs,
      ipTake.allowed ? 0 : ipTake.retryAfterMs,
    )
    event.node.res.setHeader("Retry-After", Math.ceil(retryAfterMs / 1000).toString())
    const message = !keyTake.allowed
      ? "Too many reports for this project"
      : "Too many reports from this IP"
    throw createError({ statusCode: 429, statusMessage: message })
  }

  const logsPart = parts.find((p) => p.name === "logs")
  let parsedLogs: ReturnType<typeof LogsAttachment.parse> | null = null
  if (logsPart?.data && logsPart.data.length > 0) {
    try {
      parsedLogs = LogsAttachment.parse(JSON.parse(logsPart.data.toString("utf8")))
    } catch {
      throw createError({ statusCode: 400, statusMessage: "Invalid logs payload" })
    }
  }

  const screenshotPart = parts.find((p) => p.name === "screenshot")

  // ── User-file validation + virus scan (BEFORE the report row is inserted) ─
  // We do this up here so a virus-flagged or oversized attachment fails the
  // entire intake — no report row, no screenshot/replay/logs persisted. If
  // we ran the scan after the report INSERT, a 422 here would leave the
  // dashboard with a half-report that lacks the user-file but still has the
  // screenshot + logs, which is not what "rejected" should mean.
  const userParts = parts.flatMap((p) => {
    const m = p.name?.match(/^attachment\[(\d+)\]$/)
    if (!m || !p.data || p.data.length === 0) return []
    return [{ idx: Number(m[1]), part: p }]
  })

  interface ScanMeta {
    scannedAt: Date
    scanStatus: string
    scanEngine: string
    scanDurationMs: number
  }
  const scanMetaByIdx = new Map<number, ScanMeta>()

  if (userParts.length > 0) {
    if (userParts.length > env.INTAKE_USER_FILES_MAX_COUNT) {
      throw createError({
        statusCode: 413,
        statusMessage: `Too many attachments (max ${env.INTAKE_USER_FILES_MAX_COUNT})`,
      })
    }
    let totalUserBytes = 0
    for (const { part } of userParts) {
      if (part.data.length > env.INTAKE_USER_FILE_MAX_BYTES) {
        throw createError({ statusCode: 413, statusMessage: "Attachment too large" })
      }
      const mime = part.type ?? "application/octet-stream"
      const lower = (part.filename ?? "").toLowerCase()
      if (
        DENIED_USER_FILE_MIMES.has(mime) ||
        DENIED_USER_FILE_EXTS.some((ext) => lower.endsWith(ext))
      ) {
        throw createError({
          statusCode: 415,
          statusMessage: `Attachment type not allowed: ${part.filename ?? "unnamed"}`,
        })
      }
      totalUserBytes += part.data.length
    }
    if (totalUserBytes > env.INTAKE_USER_FILES_TOTAL_MAX_BYTES) {
      throw createError({ statusCode: 413, statusMessage: "Attachments exceed total budget" })
    }

    // Virus-scan each user-file. Sequential because clamd is single-threaded
    // per connection and parallel scans against a shared socket can interleave
    // verdicts. With a 5-file cap and warm signature cache, sequential
    // scanning is < 2s in practice. Skipped when scanning is disabled.
    if (env.INTAKE_USER_FILE_SCAN_ENABLED) {
      for (const { idx, part } of userParts) {
        let scan: Awaited<ReturnType<typeof scanBytes>>
        try {
          scan = await scanBytes(new Uint8Array(part.data))
        } catch (err) {
          // Fail-closed: if the scanner is enabled but unreachable, surface a
          // 503 rather than letting unscanned bytes through.
          console.error("[intake] virus scanner unavailable", err)
          throw createError({
            statusCode: 503,
            statusMessage: "Attachment scanner unavailable, please retry",
          })
        }
        if (!scan.clean) {
          // No DB writes have happened yet — throwing here means the entire
          // report submission fails with no persistent side effects.
          throw createError({
            statusCode: 422,
            statusMessage: `Attachment rejected by virus scanner: ${part.filename ?? "unnamed"} (${scan.reason ?? "infected"})`,
          })
        }
        scanMetaByIdx.set(idx, {
          scannedAt: new Date(),
          scanStatus: "clean",
          scanEngine: scan.engine,
          scanDurationMs: scan.durationMs,
        })
      }
    }
  }

  // ── Gallery media validation + virus scan (BEFORE the report row is
  // inserted, same rationale as the user-file block above) ─────────────────
  const mediaParts = parts.flatMap((p) => {
    const m = p.name?.match(MEDIA_PART_RE)
    if (!m || !p.data || p.data.length === 0) return []
    return [{ idx: Number(m[1]), data: p.data, mime: p.type ?? "application/octet-stream" }]
  })

  interface MediaScanMeta {
    scannedAt: Date | null
    scanStatus: string
    scanEngine: string | null
    scanDurationMs: number | null
  }
  const mediaScanMetaByIdx = new Map<number, MediaScanMeta>()
  const mediaMetaByIdx = new Map<number, MediaMetaEntry>()

  if (mediaParts.length > 0) {
    const mediaMetaPart = parts.find((p) => p.name === "mediaMeta")
    if (!mediaMetaPart?.data) {
      throw createError({ statusCode: 400, statusMessage: "Missing 'mediaMeta' part" })
    }

    let rawMeta: unknown
    try {
      rawMeta = JSON.parse(mediaMetaPart.data.toString("utf8"))
    } catch {
      throw createError({ statusCode: 400, statusMessage: "Invalid mediaMeta" })
    }
    if (!Array.isArray(rawMeta)) {
      throw createError({ statusCode: 400, statusMessage: "Invalid mediaMeta" })
    }
    // Length check BEFORE the count cap: a mismatched meta array is a
    // malformed request regardless of how many parts were sent, and we want
    // a distinct 400 for it rather than letting a coincidentally-oversized
    // array masquerade as a 413.
    if (rawMeta.length !== mediaParts.length) {
      throw createError({
        statusCode: 400,
        statusMessage: "mediaMeta length must match the number of media parts",
      })
    }
    if (mediaParts.length > env.INTAKE_MEDIA_MAX_COUNT) {
      throw createError({
        statusCode: 413,
        statusMessage: `Too many media parts (max ${env.INTAKE_MEDIA_MAX_COUNT})`,
      })
    }

    let meta: MediaMetaEntry[]
    try {
      meta = rawMeta.map((entry) => MediaMetaEntry.parse(entry))
    } catch (err) {
      const issues =
        err && typeof err === "object" && "issues" in err
          ? (err as { issues: unknown }).issues
          : String(err)
      console.warn("[intake] invalid mediaMeta entry", JSON.stringify(issues, null, 2))
      throw createError({ statusCode: 400, statusMessage: "Invalid mediaMeta", data: { issues } })
    }
    meta.forEach((entry, i) => mediaMetaByIdx.set(i, entry))

    for (const { idx, data, mime } of mediaParts) {
      const m = mediaMetaByIdx.get(idx)
      if (!m) {
        throw createError({
          statusCode: 400,
          statusMessage: `mediaMeta entry missing for media[${idx}]`,
        })
      }
      if (!ALLOWED_MEDIA_MIMES.has(mime) || mime !== m.mime) {
        throw createError({
          statusCode: 415,
          statusMessage: `Media type not allowed: media[${idx}]`,
        })
      }
      const cap =
        m.kind === "image" ? env.INTAKE_MEDIA_IMAGE_MAX_BYTES : env.INTAKE_MEDIA_VIDEO_MAX_BYTES
      if (data.length > cap) {
        throw createError({
          statusCode: 413,
          statusMessage: `media[${idx}] exceeds the ${m.kind} size cap`,
        })
      }
      if (m.trim && m.durationMs !== undefined && m.trim.endMs > m.durationMs) {
        throw createError({
          statusCode: 400,
          statusMessage: `media[${idx}] trim.endMs exceeds durationMs`,
        })
      }
    }

    // Virus-scan each media part, same sequential-clamd rationale as the
    // user-file loop above. Parts over the clamd StreamMaxLength ceiling are
    // stored unscanned rather than fail-closed rejected — see
    // CLAMAV_STREAM_CEILING comment.
    if (env.INTAKE_USER_FILE_SCAN_ENABLED) {
      for (const { idx, data } of mediaParts) {
        if (data.length > CLAMAV_STREAM_CEILING) {
          mediaScanMetaByIdx.set(idx, {
            scannedAt: null,
            scanStatus: "skipped-size",
            scanEngine: null,
            scanDurationMs: null,
          })
          continue
        }
        let scan: Awaited<ReturnType<typeof scanBytes>>
        try {
          scan = await scanBytes(new Uint8Array(data))
        } catch (err) {
          console.error("[intake] virus scanner unavailable", err)
          throw createError({
            statusCode: 503,
            statusMessage: "Attachment scanner unavailable, please retry",
          })
        }
        if (!scan.clean) {
          throw createError({
            statusCode: 422,
            statusMessage: `Media rejected by virus scanner: media[${idx}] (${scan.reason ?? "infected"})`,
          })
        }
        mediaScanMetaByIdx.set(idx, {
          scannedAt: new Date(),
          scanStatus: "clean",
          scanEngine: scan.engine,
          scanDurationMs: scan.durationMs,
        })
      }
    }
  }

  // SEC2: Daily ceiling — hard cap on reports per project per rolling 24h
  // window. Previously the COUNT and INSERT ran in separate statements which
  // allowed concurrent requests to all observe count = cap-1 and each commit
  // an insert, breaching the cap by up to (concurrency - 1) per burst.
  //
  // Fix: wrap the count-check + insert in a single transaction guarded by a
  // pg_advisory_xact_lock keyed on (project_id, rolling window start). The
  // lock serializes only intakes for the same project — other projects are
  // unaffected, and readers outside this path are never blocked. Advisory
  // locks avoid the retry storms a full SERIALIZABLE isolation would produce.
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const txResult = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`intake:${project.id}:daily`}))`)

    const [countRow] = await tx
      .select({ c: count() })
      .from(reports)
      .where(and(eq(reports.projectId, project.id), gte(reports.createdAt, dayAgo)))
    const todayCount = countRow?.c ?? 0
    if (todayCount >= project.dailyReportCap) {
      return { overCap: true as const }
    }

    const [inserted] = await tx
      .insert(reports)
      .values({
        projectId: project.id,
        title: parsed.title,
        description: parsed.description ?? null,
        context: { ...parsed.context, ...(parsed.metadata ? { metadata: parsed.metadata } : {}) },
        origin,
        ip,
        source: parsed.context.source,
        devicePlatform: parsed.context.systemInfo?.devicePlatform ?? null,
        idempotencyKey,
      })
      .returning()
    return { overCap: false as const, report: inserted }
  })

  if (txResult.overCap) {
    event.node.res.setHeader("Retry-After", "3600")
    throw createError({ statusCode: 429, statusMessage: "Daily report cap reached" })
  }
  const report = txResult.report
  if (!report) {
    throw createError({ statusCode: 500, statusMessage: "Insert failed" })
  }

  const replayPart = parts.find((p) => p.name === "replay")
  const replayFeatureOn = env.REPLAY_FEATURE_ENABLED
  const projectAllowsReplay = project.replayEnabled
  const replayDisabled = !replayFeatureOn || !projectAllowsReplay
  let replayStored = false

  if (replayPart?.data && replayPart.data.length > 0) {
    if (replayPart.data.length > env.INTAKE_REPLAY_MAX_BYTES) {
      throw createError({ statusCode: 413, statusMessage: "Replay payload too large" })
    }
    if (replayDisabled) {
      // Silently drop — success-with-signal semantics (see spec §6).
    } else {
      const storage = await getStorage()
      const key = `${report.id}/replay.json.gz`
      await storage.put(key, new Uint8Array(replayPart.data), "application/gzip")
      await db.insert(reportAttachments).values({
        reportId: report.id,
        kind: "replay",
        storageKey: key,
        contentType: "application/gzip",
        sizeBytes: replayPart.data.length,
      })
      replayStored = true
    }
  }

  // P3: Call getStorage() once and fan out attachment writes with Promise.all.
  // Screenshot and logs uploads no longer serialize.
  const screenshotData =
    screenshotPart?.data && screenshotPart.data.length > 0 ? screenshotPart.data : null
  const logsData = parsedLogs && logsPart?.data ? logsPart.data : null
  if (screenshotData !== null || logsData !== null) {
    const storage = await getStorage()
    const writes: Promise<void>[] = []
    if (screenshotData !== null) {
      const key = `${report.id}/screenshot.png`
      writes.push(
        storage
          .put(key, new Uint8Array(screenshotData), "image/png")
          .then(() =>
            db.insert(reportAttachments).values({
              reportId: report.id,
              kind: "screenshot",
              storageKey: key,
              contentType: "image/png",
              sizeBytes: screenshotData.length,
            }),
          )
          .then(() => undefined),
      )
    }
    if (logsData !== null) {
      const key = `${report.id}/logs.json`
      writes.push(
        storage
          .put(key, new Uint8Array(logsData), "application/json")
          .then(() =>
            db.insert(reportAttachments).values({
              reportId: report.id,
              kind: "logs",
              storageKey: key,
              contentType: "application/json",
              sizeBytes: logsData.length,
            }),
          )
          .then(() => undefined),
      )
    }
    await Promise.all(writes)
  }

  // ── Persist user-file attachments (kind = "user-file") ────────────────────
  // All validation + virus-scanning ran above, BEFORE the report row was
  // inserted, so by the time we get here every part is known-clean and
  // within size/count budgets. Storage put + DB insert is all that's left.
  if (userParts.length > 0) {
    const storage = await getStorage()
    const writtenKeys: string[] = []
    try {
      await Promise.all(
        userParts.map(async ({ idx, part }) => {
          const safeName = sanitizeFilename(part.filename ?? "", idx)
          const mime = part.type ?? "application/octet-stream"
          const key = `${report.id}/user/${idx}-${safeName}`
          await storage.put(key, new Uint8Array(part.data), mime)
          writtenKeys.push(key)
          const meta = scanMetaByIdx.get(idx)
          await db.insert(reportAttachments).values({
            reportId: report.id,
            kind: "user-file",
            storageKey: key,
            contentType: mime,
            sizeBytes: part.data.length,
            filename: safeName,
            scannedAt: meta?.scannedAt ?? null,
            scanStatus: meta?.scanStatus ?? null,
            scanEngine: meta?.scanEngine ?? null,
            scanDurationMs: meta?.scanDurationMs ?? null,
          })
        }),
      )
    } catch (err) {
      await rollbackPuts(storage, writtenKeys)
      throw err
    }
  }

  // ── Persist gallery media attachments (kind = "media") ────────────────────
  // All validation + virus-scanning ran above, BEFORE the report row was
  // inserted, so every part here is known-clean and within its size cap.
  if (mediaParts.length > 0) {
    const storage = await getStorage()
    const writtenKeys: string[] = []
    try {
      // Sequential (not Promise.all) so writtenKeys only ever contains keys
      // that have actually landed in storage before any failure, in a
      // well-defined order — mirrors the user-file block's rollback contract.
      for (const { idx, data, mime } of mediaParts) {
        const m = mediaMetaByIdx.get(idx)!
        const ext = MEDIA_EXT[mime] ?? "bin"
        const key = `${report.id}/media/${idx}.${ext}`
        await storage.put(key, new Uint8Array(data), mime)
        writtenKeys.push(key)
        const scanMeta = mediaScanMetaByIdx.get(idx)
        await db.insert(reportAttachments).values({
          reportId: report.id,
          kind: "media",
          storageKey: key,
          contentType: mime,
          sizeBytes: data.length,
          filename: `media-${idx}.${ext}`,
          durationMs: m.durationMs ?? null,
          trimStartMs: m.trim?.startMs ?? null,
          trimEndMs: m.trim?.endMs ?? null,
          scannedAt: scanMeta?.scannedAt ?? null,
          scanStatus: scanMeta?.scanStatus ?? null,
          scanEngine: scanMeta?.scanEngine ?? null,
          scanDurationMs: scanMeta?.scanDurationMs ?? null,
        })
      }
    } catch (err) {
      await rollbackPuts(storage, writtenKeys)
      throw err
    }
  }

  // Auto-create GitHub issue on intake when the toggle is on.
  // Runs after all attachments are persisted so the sync worker sees them.
  // Fire-and-forget: enqueueSync is a single SQL UPSERT (microseconds), so a
  // plain await does not meaningfully delay the 201 response to the SDK.
  const [integration] = await db
    .select({
      status: githubIntegrations.status,
      autoCreateOnIntake: githubIntegrations.autoCreateOnIntake,
      repoOwner: githubIntegrations.repoOwner,
      repoName: githubIntegrations.repoName,
    })
    .from(githubIntegrations)
    .where(eq(githubIntegrations.projectId, project.id))
    .limit(1)

  if (
    integration &&
    integration.status === "connected" &&
    integration.autoCreateOnIntake &&
    integration.repoOwner &&
    integration.repoName
  ) {
    await enqueueSync(report.id, project.id).catch((err) => {
      console.error("[github] enqueueSync failed on intake", err)
    })
  }

  event.node.res.statusCode = 201
  event.node.res.setHeader("Repro-Scan-Enabled", env.INTAKE_USER_FILE_SCAN_ENABLED ? "1" : "0")
  return {
    id: report.id,
    scanEnabled: env.INTAKE_USER_FILE_SCAN_ENABLED,
    ...(replayPart ? { replayStored, replayDisabled } : {}),
  }
})
