// apps/dashboard/server/api/projects/[id]/reports/[reportId]/comments/upload-image.post.ts
//
// Receives a single image pasted/dropped into the comment composer, persists
// it to the storage adapter, and returns an absolute signed URL the client
// can splice into the comment markdown.
//
// Why absolute + signed:
//   The comment body gets mirrored to GitHub via the sync runner. GitHub
//   renders comment markdown through their image proxy ("camo") which makes
//   an *anonymous* request to the image URL. So the URL must be:
//     (a) absolute — camo doesn't know what host the comment came from,
//     (b) reachable without a session — camo has no dashboard cookie.
//   We satisfy both by signing the upload's storage path with HMAC and
//   embedding the token + expiry in the URL. The companion GET endpoint
//   accepts the signed token as a fast-path alternative to session auth.
//
// Storage layout (no DB row — the comment body referencing the URL IS the
// implicit audit trail):
//   comment-uploads/<projectId>/<reportId>/<uuid>.<ext>
//
// Limits: image/* MIME, ≤8 MiB, one file per request.
import { createHmac } from "node:crypto"
import { randomUUID } from "node:crypto"
import { createError, defineEventHandler, getRouterParam, readMultipartFormData } from "h3"
import { env } from "../../../../../../lib/env"
import { requireProjectRole } from "../../../../../../lib/permissions"
import { getStorage } from "../../../../../../lib/storage"

const MAX_BYTES = 8 * 1024 * 1024 // 8 MiB
const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"])

const EXT_FOR_TYPE: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
}

// 365 days. The signed URL is embedded in a comment body that is mirrored to
// GitHub; their image proxy re-fetches on cache expiry, so a short TTL would
// silently break old images. Tokens are unguessable (UUID path + HMAC) so the
// blast radius of a long lifetime is bounded.
const TOKEN_TTL_SECONDS = 365 * 24 * 3600

function signCommentImageToken(params: {
  projectId: string
  reportId: string
  fileId: string
  expiresAt: number
}): string {
  return createHmac("sha256", env.ATTACHMENT_URL_SECRET)
    .update(
      `comment-image:${params.projectId}:${params.reportId}:${params.fileId}:${params.expiresAt}`,
    )
    .digest("hex")
}

export default defineEventHandler(
  async (event): Promise<{ id: string; url: string; contentType: string; sizeBytes: number }> => {
    const projectId = getRouterParam(event, "id")
    const reportId = getRouterParam(event, "reportId")
    if (!projectId || !reportId) {
      throw createError({ statusCode: 400, statusMessage: "missing params" })
    }
    // Same floor as posting a comment (index.post.ts): the only consumer of
    // an upload is a comment body, so anyone who may comment may attach.
    await requireProjectRole(event, projectId, "manager")

    const parts = await readMultipartFormData(event)
    if (!parts || parts.length === 0) {
      throw createError({ statusCode: 400, statusMessage: "No file in request" })
    }

    const file = parts.find((p) => p.name === "file" || p.filename)
    if (!file || !file.data) {
      throw createError({ statusCode: 400, statusMessage: "Missing 'file' part" })
    }

    const contentType = (file.type ?? "").toLowerCase()
    if (!ALLOWED_TYPES.has(contentType)) {
      throw createError({
        statusCode: 415,
        statusMessage: "Unsupported image type — png, jpeg, webp, or gif",
      })
    }
    if (file.data.byteLength > MAX_BYTES) {
      throw createError({ statusCode: 413, statusMessage: "Image exceeds 8 MiB limit" })
    }

    const id = randomUUID()
    const ext = EXT_FOR_TYPE[contentType] ?? "bin"
    const fileId = `${id}.${ext}`
    const storageKey = `comment-uploads/${projectId}/${reportId}/${fileId}`

    const storage = await getStorage()
    await storage.put(
      storageKey,
      new Uint8Array(file.data.buffer, file.data.byteOffset, file.data.byteLength),
      contentType,
    )

    const expiresAt = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS
    const token = signCommentImageToken({ projectId, reportId, fileId, expiresAt })

    // Absolute URL — comment bodies that round-trip through GitHub need the
    // host bound at the URL itself.
    const path = `/api/projects/${projectId}/reports/${reportId}/comments/uploads/${fileId}?token=${token}&expires=${expiresAt}`
    const baseUrl = env.BETTER_AUTH_URL.replace(/\/+$/, "")
    const absoluteUrl = `${baseUrl}${path}`

    return {
      id: fileId,
      url: absoluteUrl,
      contentType,
      sizeBytes: file.data.byteLength,
    }
  },
)
