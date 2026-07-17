import { randomBytes, randomUUID } from "node:crypto"
import {
  createError,
  defineEventHandler,
  getHeader,
  getRequestIP,
  getRequestURL,
  readMultipartFormData,
} from "h3"
import { eq } from "drizzle-orm"
import { z } from "zod"
import { db } from "../../db"
import { projects, sharedMedia } from "../../db/schema"
import {
  applyIntakePostCors,
  applyIntakePreflightCors,
  isOriginAllowed,
} from "../../lib/intake-cors"
import { env } from "../../lib/env"
import { getIpLimiter, getShareMintLimiter } from "../../lib/rate-limit"
import { getStorage } from "../../lib/storage"
import { rollbackPuts } from "../../lib/storage/rollback"

// Strip any `;codecs=...` parameters so a browser-emitted content-type like
// `video/webm;codecs=vp9` (Chrome's MediaRecorder default) is validated and
// stored as the bare `video/webm` the allowlist expects.
function bareMime(m: string): string {
  return m.split(";")[0]?.trim() ?? m
}

// v1 supports minting share links for gallery recordings only — no images.
const MintMeta = z.object({
  projectKey: z.string().regex(/^rp_pk_[A-Za-z0-9]{24}$/),
  kind: z.literal("video"),
  // Normalize BEFORE the enum so a parameterized codec string still validates
  // (and is persisted bare). A still-unsupported mime keeps the `mime` issue
  // path, preserving the 415 mapping below.
  mime: z
    .string()
    .transform(bareMime)
    .pipe(z.enum(["video/webm", "video/mp4"])),
  durationMs: z.number().int().nonnegative().optional(),
  trim: z
    .object({ startMs: z.number().int().nonnegative(), endMs: z.number().int().positive() })
    .refine((t) => t.endMs > t.startMs, "endMs must be after startMs")
    .optional(),
})

const MEDIA_EXT: Record<string, string> = {
  "video/webm": "webm",
  "video/mp4": "mp4",
}

const DAY_MS = 86_400_000
// Token collisions at 256 bits of entropy are effectively impossible, but the
// unique constraint is real defense-in-depth (e.g. a broken RNG). One retry
// with a freshly-generated token covers that case cheaply; a second failure
// is treated as a genuine server error rather than looping forever.
const MAX_MINT_ATTEMPTS = 2

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
  // Same chrome-extension:// → X-Repro-Origin fallback as reports.ts — see
  // that file's comment for the full threat-model rationale.
  const origin =
    rawOrigin.length > 0 && rawOrigin.startsWith("chrome-extension://")
      ? (getHeader(event, "x-repro-origin") ?? "")
      : rawOrigin
  // TRUST_XFF is OFF by default — a public deployment must not be trivially
  // rate-limit-bypassed via a spoofed X-Forwarded-For header. Same rationale
  // as reports.ts.
  const ip = getRequestIP(event, { xForwardedFor: env.TRUST_XFF }) ?? "unknown"

  // Pre-buffer size gate: readMultipartFormData below buffers the ENTIRE body
  // into RAM before any other check runs, so an oversized (or maliciously huge)
  // body would be fully read pre-auth. Reject on the declared Content-Length
  // first. Content-Length can be absent or lie (chunked bodies), so the
  // post-parse video-size cap stays as the authoritative check; this only caps
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

  const metaPart = parts.find((p) => p.name === "meta")
  if (!metaPart?.data) {
    throw createError({ statusCode: 400, statusMessage: "Missing 'meta' part" })
  }
  const filePart = parts.find((p) => p.name === "file")
  if (!filePart?.data || filePart.data.length === 0) {
    throw createError({ statusCode: 400, statusMessage: "Missing 'file' part" })
  }

  let meta: z.infer<typeof MintMeta>
  try {
    meta = MintMeta.parse(JSON.parse(metaPart.data.toString("utf8")))
  } catch (err) {
    // Distinguish "mime not in the video-only allowlist" (415, a content-type
    // rejection) from every other malformed-payload case (400). This is the
    // only field with product-visible semantics beyond "the JSON is wrong".
    if (err instanceof z.ZodError && err.issues.every((i) => i.path.join(".") === "mime")) {
      throw createError({ statusCode: 415, statusMessage: "Unsupported media mime type" })
    }
    const issues =
      err && typeof err === "object" && "issues" in err
        ? (err as { issues: unknown }).issues
        : String(err)
    console.warn("[share-mint] invalid meta payload", JSON.stringify(issues, null, 2))
    throw createError({ statusCode: 400, statusMessage: "Invalid meta payload", data: { issues } })
  }

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.publicKey, meta.projectKey))
    .limit(1)
  if (!project || project.deletedAt) {
    throw createError({ statusCode: 401, statusMessage: "Invalid project key" })
  }

  // Origin allowlist MUST be checked before the rate limiter takes, otherwise
  // an attacker with just a leaked project key can burn the legitimate SDK's
  // quota from any origin (including origins not on the allowlist). Same
  // ordering rationale as reports.ts.
  if (!isOriginAllowed(origin, project.allowedOrigins)) {
    // Deliberately do NOT emit ACAO here — cross-origin scripts cannot read
    // this 403 body, which removes the cross-origin enumeration oracle.
    throw createError({ statusCode: 403, statusMessage: "Origin not allowed" })
  }

  // Origin validated: emit ACAO so the legitimate SDK (on this allowed
  // origin) can read both success AND error bodies of the rest of this
  // request. Use the RAW origin, matching reports.ts.
  if (rawOrigin) {
    applyIntakePostCors(event, rawOrigin)
  }

  if (!project.shareLinksEnabled) {
    throw createError({
      statusCode: 403,
      statusMessage: "Share links are disabled for this project",
    })
  }

  // Defense-in-depth: the actual uploaded part's content-type must agree
  // with the mime the caller declared in meta (which is already restricted
  // to the video-only allowlist by the zod schema above).
  const fileMime = bareMime(filePart.type ?? "")
  if (fileMime !== meta.mime) {
    throw createError({
      statusCode: 415,
      statusMessage: "File content-type does not match meta.mime",
    })
  }

  // Fire the per-project mint limiter and the per-IP limiter in parallel
  // (mirrors reports.ts). The per-IP take stops one project key from being
  // used to hammer mints from a single host even while the project quota has
  // room, and vice-versa.
  const shareLimiter = await getShareMintLimiter()
  const ipLimiter = await getIpLimiter()
  const [shareTake, ipTake] = await Promise.all([
    shareLimiter.take(`share:${project.id}`),
    ipLimiter.take(`ip:${ip}`),
  ])
  if (!shareTake.allowed || !ipTake.allowed) {
    const retryAfterMs = Math.max(
      shareTake.allowed ? 0 : shareTake.retryAfterMs,
      ipTake.allowed ? 0 : ipTake.retryAfterMs,
    )
    event.node.res.setHeader("Retry-After", Math.ceil(retryAfterMs / 1000).toString())
    const message = !shareTake.allowed
      ? "Too many share links minted for this project"
      : "Too many share links minted from this IP"
    throw createError({ statusCode: 429, statusMessage: message })
  }

  if (filePart.data.length > env.INTAKE_MEDIA_VIDEO_MAX_BYTES) {
    throw createError({ statusCode: 413, statusMessage: "File exceeds the video size cap" })
  }

  if (meta.trim && meta.durationMs !== undefined && meta.trim.endMs > meta.durationMs) {
    throw createError({ statusCode: 400, statusMessage: "trim.endMs exceeds durationMs" })
  }

  const storage = await getStorage()
  const id = randomUUID()
  const ext = MEDIA_EXT[meta.mime]
  const key = `shared-media/${id}.${ext}`
  await storage.put(key, new Uint8Array(filePart.data), meta.mime)

  const expiresAt = new Date(Date.now() + project.shareRetentionDays * DAY_MS)

  let inserted: typeof sharedMedia.$inferSelect | undefined
  let lastErr: unknown = null
  for (let attempt = 0; attempt < MAX_MINT_ATTEMPTS; attempt++) {
    const token = randomBytes(32).toString("base64url")
    try {
      const rows = await db
        .insert(sharedMedia)
        .values({
          id,
          projectId: project.id,
          token,
          kind: meta.kind,
          mime: meta.mime,
          storageKey: key,
          sizeBytes: filePart.data.length,
          durationMs: meta.durationMs ?? null,
          trimStartMs: meta.trim?.startMs ?? null,
          trimEndMs: meta.trim?.endMs ?? null,
          expiresAt,
        })
        .returning()
      inserted = rows[0]
      lastErr = null
      break
    } catch (err) {
      lastErr = err
      // Only a unique-violation is worth retrying (token collision, or in
      // principle the client-generated id). Anything else is a real error —
      // bubble out immediately instead of masking it with a retry loop.
      const code = (err as { code?: string }).code
      if (code !== "23505") break
    }
  }

  if (!inserted) {
    await rollbackPuts(storage, [key])
    console.error("[share-mint] insert failed after retries", lastErr)
    throw createError({ statusCode: 500, statusMessage: "Failed to mint share link" })
  }

  event.node.res.statusCode = 201
  return {
    id: inserted.id,
    token: inserted.token,
    shareUrl: `${getRequestURL(event).origin}/s/${inserted.token}`,
    expiresAt: expiresAt.toISOString(),
  }
})
