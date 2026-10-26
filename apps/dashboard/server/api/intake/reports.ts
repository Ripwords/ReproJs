import {
  createError,
  defineEventHandler,
  getHeader,
  getRequestIP,
  readMultipartFormData,
  setResponseHeader,
} from "h3"
import { and, count, eq, gte, sql } from "drizzle-orm"
import { randomUUID } from "node:crypto"
import { LogsAttachment, MediaMetaEntry, ReportIntakeInput } from "@reprojs/shared"
import { db } from "../../db"
import { githubIntegrations, projects, reports, reportAttachments } from "../../db/schema"
import type { NewReportAttachment } from "../../db/schema"
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
// Strip any `;codecs=...`/`;charset=...` parameters so a browser-emitted
// content-type like `video/webm;codecs=vp9` (Chrome's MediaRecorder default)
// is validated and stored as the bare `video/webm` the allowlist expects.
function bareMime(m: string): string {
  return m.split(";")[0]?.trim() ?? m
}
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
    // RFC 9110 §15.5.6: a 405 MUST carry Allow. Browsers land here whenever
    // something navigates to the intake URL (an auth redirect that used it as
    // a callback target, a pasted link, a link checker), and the bare status
    // line gives no clue what the endpoint is for.
    setResponseHeader(event, "allow", "POST, OPTIONS")
    throw createError({
      statusCode: 405,
      statusMessage: "Method not allowed",
      message: "This endpoint only accepts POST from the Repro SDK.",
    })
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

  // Pre-buffer size gate: readMultipartFormData below buffers the ENTIRE body
  // into RAM before any other check runs, so an oversized (or maliciously huge)
  // body would be fully read pre-auth. Reject on the declared Content-Length
  // first. Content-Length can be absent or lie (chunked bodies), so the
  // post-parse totalBytes gate stays as the authoritative check; this only caps
  // the honest-but-oversized common case cheaply. Deployments that must also
  // bound chunked/streamed bodies should set a reverse-proxy body cap.
  const declaredLength = getHeader(event, "content-length")
  if (declaredLength !== undefined && Number(declaredLength) > env.INTAKE_MAX_BYTES) {
    throw createError({ statusCode: 413, statusMessage: "Payload too large" })
  }

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
  //
  // Only a report whose attachments are all present qualifies. A row with
  // fewer attachments than this request carries is a half-stored report from
  // a failed earlier attempt; we fall through and repair it in place (same
  // id) instead of handing back a report the SDK can never complete.
  let repairTarget: { id: string } | null = null
  if (idempotencyKey) {
    const existing = await findReportByIdempotencyKey(db, project.id, idempotencyKey)
    if (existing) {
      const expected = countExpectedAttachments(
        parts,
        env.REPLAY_FEATURE_ENABLED && project.replayEnabled,
      )
      if (existing.attachmentCount >= expected) {
        event.node.res.statusCode = 200
        return { id: existing.id }
      }
      repairTarget = { id: existing.id }
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
  // A malformed logs part must NOT discard the report. Logs are auto-collected
  // decoration; the report is the reporter's actual work. Rejecting the whole
  // submission over a bad sidecar is how an SDK serializer bug (a non-string
  // console arg landing as `null`) silently swallowed every Expo/iOS report in
  // production — the SDK saw a non-retryable 400 and deleted the queued
  // report, while this branch logged nothing. Drop the logs, keep the report,
  // and signal it back via `logsStored` (same success-with-signal shape as
  // `replayStored`/`replayDisabled`).
  let logsRejected = false
  if (logsPart?.data && logsPart.data.length > 0) {
    try {
      parsedLogs = LogsAttachment.parse(JSON.parse(logsPart.data.toString("utf8")))
    } catch (err) {
      logsRejected = true
      parsedLogs = null
      const issues =
        err && typeof err === "object" && "issues" in err
          ? (err as { issues: unknown }).issues
          : String(err)
      console.warn(
        `[intake] dropping invalid logs part for project ${project.id} (source=${parsed.context.source})`,
        JSON.stringify(issues, null, 2),
      )
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
    return [
      { idx: Number(m[1]), data: p.data, mime: bareMime(p.type ?? "application/octet-stream") },
    ]
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
    // Indices must form the exact unique contiguous set 0..mediaParts.length-1.
    // Without this, duplicate media[N] parts (e.g. two media[0]s) both pass
    // the mediaMeta length check below, both resolve the same mediaMeta
    // entry, and both persist to the SAME storage key
    // `${report.id}/media/N.<ext>` — the second `storage.put` silently
    // overwrites the first blob while two attachment rows end up pointing at
    // one key with divergent sizes. Gaps/out-of-range indices (e.g. a lone
    // media[7]) are equally malformed and are now caught here too, instead
    // of surfacing as a less specific "mediaMeta entry missing" error later.
    const seenMediaIdx = new Set<number>()
    for (const { idx } of mediaParts) {
      if (idx >= mediaParts.length || seenMediaIdx.has(idx)) {
        throw createError({
          statusCode: 400,
          statusMessage: "media part indices must be unique and contiguous",
        })
      }
      seenMediaIdx.add(idx)
    }

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
      // Normalize the declared mediaMeta mime the same way as the part mime so
      // a parameterized codec string on either side (part content-type or the
      // sidecar meta) still matches and stays on the bare allowlist.
      if (!ALLOWED_MEDIA_MIMES.has(mime) || mime !== bareMime(m.mime)) {
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

  // ── Replay validation (BEFORE any write) ───────────────────────────────────
  // The size check used to run after the report row was committed, so a
  // replay a few bytes over the cap produced a 413 *and* an orphan report
  // with zero attachments. Every part is now validated before the first
  // storage or DB write.
  const replayPart = parts.find((p) => p.name === "replay")
  const replayDisabled = !env.REPLAY_FEATURE_ENABLED || !project.replayEnabled
  const replayData = replayPart?.data && replayPart.data.length > 0 ? replayPart.data : null
  if (replayData !== null && replayData.length > env.INTAKE_REPLAY_MAX_BYTES) {
    throw createError({ statusCode: 413, statusMessage: "Replay payload too large" })
  }
  // Silently drop when disabled — success-with-signal semantics (see spec §6).
  const replayStored = replayData !== null && !replayDisabled

  const screenshotData =
    screenshotPart?.data && screenshotPart.data.length > 0 ? screenshotPart.data : null
  const logsData = parsedLogs && logsPart?.data ? logsPart.data : null

  // ── Attachment plan ─────────────────────────────────────────────────────────
  // Storage keys embed the report id, so pick it up front. For an idempotent
  // retry that found a half-stored row we reuse that row's id and repair it
  // in place; otherwise mint a fresh one.
  const reportId = repairTarget?.id ?? randomUUID()
  const planned: PlannedAttachment[] = []
  if (replayStored && replayData !== null) {
    planned.push({
      bytes: new Uint8Array(replayData),
      row: {
        kind: "replay",
        storageKey: `${reportId}/replay.json.gz`,
        contentType: "application/gzip",
        sizeBytes: replayData.length,
      },
    })
  }
  if (screenshotData !== null) {
    planned.push({
      bytes: new Uint8Array(screenshotData),
      row: {
        kind: "screenshot",
        storageKey: `${reportId}/screenshot.png`,
        contentType: "image/png",
        sizeBytes: screenshotData.length,
      },
    })
  }
  if (logsData !== null) {
    planned.push({
      bytes: new Uint8Array(logsData),
      row: {
        kind: "logs",
        storageKey: `${reportId}/logs.json`,
        contentType: "application/json",
        sizeBytes: logsData.length,
      },
    })
  }
  for (const { idx, part } of userParts) {
    const safeName = sanitizeFilename(part.filename ?? "", idx)
    const mime = part.type ?? "application/octet-stream"
    const meta = scanMetaByIdx.get(idx)
    planned.push({
      bytes: new Uint8Array(part.data),
      row: {
        kind: "user-file",
        storageKey: `${reportId}/user/${idx}-${safeName}`,
        contentType: mime,
        sizeBytes: part.data.length,
        filename: safeName,
        scannedAt: meta?.scannedAt ?? null,
        scanStatus: meta?.scanStatus ?? null,
        scanEngine: meta?.scanEngine ?? null,
        scanDurationMs: meta?.scanDurationMs ?? null,
      },
    })
  }
  for (const { idx, data, mime } of mediaParts) {
    const m = mediaMetaByIdx.get(idx)!
    const ext = MEDIA_EXT[mime] ?? "bin"
    const scanMeta = mediaScanMetaByIdx.get(idx)
    planned.push({
      bytes: new Uint8Array(data),
      row: {
        kind: "media",
        storageKey: `${reportId}/media/${idx}.${ext}`,
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
      },
    })
  }

  // ── Blobs first ─────────────────────────────────────────────────────────────
  // Storage is written before any row exists, so a failed upload can never
  // leave a report that points at missing bytes. Keys only ever contain
  // report-scoped paths, so a rollback here cannot touch anyone else's data.
  const storage = await getStorage()
  const plannedKeys = planned.map((p) => p.row.storageKey)
  const writtenKeys: string[] = []
  try {
    await Promise.all(
      planned.map(async (p) => {
        await storage.put(p.row.storageKey, p.bytes, p.row.contentType)
        writtenKeys.push(p.row.storageKey)
      }),
    )
  } catch (err) {
    console.error("[intake] attachment storage write failed", err)
    await rollbackPuts(storage, writtenKeys)
    throw createError({ statusCode: 500, statusMessage: "Attachment storage failed" })
  }

  // ── One transaction: report row + every attachment row ─────────────────────
  // SEC2: Daily ceiling — hard cap on reports per project per rolling 24h
  // window. The COUNT and INSERT run in one transaction guarded by a
  // pg_advisory_xact_lock keyed on the project, so concurrent requests can't
  // all observe count = cap-1 and each commit. The lock serializes only
  // intakes for the same project. The same lock also serializes idempotent
  // retries, so the re-check below is authoritative.
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
  type TxOutcome =
    | { kind: "created" }
    | { kind: "repaired" }
    | { kind: "duplicate"; id: string }
    | { kind: "overCap" }
  let txResult: TxOutcome
  try {
    txResult = await db.transaction(async (tx): Promise<TxOutcome> => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`intake:${project.id}:daily`}))`)

      const current = idempotencyKey
        ? await findReportByIdempotencyKey(tx, project.id, idempotencyKey)
        : null
      if (current && current.id !== reportId) {
        // Another request with the same key committed while we were uploading.
        return { kind: "duplicate", id: current.id }
      }

      if (current) {
        // Repair: the row exists but its attachments never landed. Replace
        // whatever partial set is there with the full plan.
        await tx.delete(reportAttachments).where(eq(reportAttachments.reportId, reportId))
      } else {
        const [countRow] = await tx
          .select({ c: count() })
          .from(reports)
          .where(and(eq(reports.projectId, project.id), gte(reports.createdAt, dayAgo)))
        if ((countRow?.c ?? 0) >= project.dailyReportCap) {
          return { kind: "overCap" }
        }
        const inserted = await tx
          .insert(reports)
          .values({
            id: reportId,
            projectId: project.id,
            title: parsed.title,
            description: parsed.description ?? null,
            context: {
              ...parsed.context,
              ...(parsed.metadata ? { metadata: parsed.metadata } : {}),
            },
            origin,
            ip,
            source: parsed.context.source,
            devicePlatform: parsed.context.systemInfo?.devicePlatform ?? null,
            idempotencyKey,
          })
          // Belt and braces for the partial unique index on
          // (project_id, idempotency_key): the advisory lock already
          // serializes same-project intakes, but a conflict here must never
          // surface as a 500.
          .onConflictDoNothing({
            target: [reports.projectId, reports.idempotencyKey],
            where: sql`${reports.idempotencyKey} IS NOT NULL`,
          })
          .returning({ id: reports.id })
        if (inserted.length === 0) {
          const winner = idempotencyKey
            ? await findReportByIdempotencyKey(tx, project.id, idempotencyKey)
            : null
          if (!winner) throw new Error("report insert conflicted but no winner row found")
          return { kind: "duplicate", id: winner.id }
        }
      }

      if (planned.length > 0) {
        await tx.insert(reportAttachments).values(planned.map((p) => ({ reportId, ...p.row })))
      }
      return current ? { kind: "repaired" } : { kind: "created" }
    })
  } catch (err) {
    await rollbackPuts(storage, plannedKeys)
    throw err
  }

  if (txResult.kind === "overCap") {
    await rollbackPuts(storage, plannedKeys)
    event.node.res.setHeader("Retry-After", "3600")
    throw createError({ statusCode: 429, statusMessage: "Daily report cap reached" })
  }
  if (txResult.kind === "duplicate") {
    await rollbackPuts(storage, plannedKeys)
    event.node.res.statusCode = 200
    return { id: txResult.id }
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
    await enqueueSync(reportId, project.id).catch((err) => {
      console.error("[github] enqueueSync failed on intake", err)
    })
  }

  event.node.res.statusCode = 201
  event.node.res.setHeader("Repro-Scan-Enabled", env.INTAKE_USER_FILE_SCAN_ENABLED ? "1" : "0")
  return {
    id: reportId,
    scanEnabled: env.INTAKE_USER_FILE_SCAN_ENABLED,
    ...(replayPart ? { replayStored, replayDisabled } : {}),
    ...(logsPart ? { logsStored: !logsRejected && logsData !== null } : {}),
  }
})

interface PlannedAttachment {
  bytes: Uint8Array
  row: Omit<NewReportAttachment, "reportId">
}

type DbExecutor = Pick<typeof db, "select">

/** The report row (if any) already holding this (project, Idempotency-Key). */
async function findReportByIdempotencyKey(
  ex: DbExecutor,
  projectId: string,
  key: string,
): Promise<{ id: string; attachmentCount: number } | null> {
  const [row] = await ex
    .select({ id: reports.id })
    .from(reports)
    .where(and(eq(reports.projectId, projectId), eq(reports.idempotencyKey, key)))
    .limit(1)
  if (!row) return null
  const [c] = await ex
    .select({ c: count() })
    .from(reportAttachments)
    .where(eq(reportAttachments.reportId, row.id))
  return { id: row.id, attachmentCount: c?.c ?? 0 }
}

/**
 * How many attachment rows a request *would* produce, judged from the raw
 * multipart parts alone. Used by the idempotency short-circuit to tell a
 * complete prior submission (return 200) from a half-stored one (repair).
 * Deliberately a cheap upper bound: a part that later fails validation makes
 * us fall through to the full path, which is the safe direction.
 */
function countExpectedAttachments(
  parts: NonNullable<Awaited<ReturnType<typeof readMultipartFormData>>>,
  replayAllowed: boolean,
): number {
  let n = 0
  for (const p of parts) {
    if (!p.data || p.data.length === 0 || !p.name) continue
    if (p.name === "screenshot" || p.name === "logs") n++
    else if (p.name === "replay" && replayAllowed) n++
    else if (/^attachment\[\d+\]$/.test(p.name) || MEDIA_PART_RE.test(p.name)) n++
  }
  return n
}
