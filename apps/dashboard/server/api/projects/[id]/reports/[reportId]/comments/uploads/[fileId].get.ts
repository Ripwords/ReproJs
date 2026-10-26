// apps/dashboard/server/api/projects/[id]/reports/[reportId]/comments/uploads/[fileId].get.ts
//
// Serves a comment-composer image upload. Pairs with `upload-image.post.ts`.
// Two access paths:
//
//   1. Signed-token fast path — when the URL carries `?token=...&expires=...`
//      we verify the HMAC and serve anonymously. This is the path GitHub's
//      image proxy ("camo") and any logged-out viewer of a synced comment
//      take. Tokens cover (projectId, reportId, fileId, expiresAt), so a
//      token minted for one upload can't be replayed for another.
//
//   2. Session path — for in-dashboard rendering with no token, the caller
//      must hold viewer role on the project.
//
// Storage key is `comment-uploads/<projectId>/<reportId>/<fileId>`; the
// fileId is regex-validated to `<uuid>.<ext>` so callers can't traverse
// out of the report's prefix.
import { Buffer } from "node:buffer"
import { createHmac, timingSafeEqual } from "node:crypto"
import { createError, defineEventHandler, getQuery, getRouterParam, setHeader } from "h3"
import { getAttachmentVerifySecrets } from "../../../../../../../lib/env"
import { requireProjectRole } from "../../../../../../../lib/permissions"
import { getStorage } from "../../../../../../../lib/storage"

const FILE_ID_RE = /^[0-9a-f-]{36}\.(png|jpg|webp|gif)$/i

const EXT_TO_TYPE: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
}

function verifyToken(params: {
  projectId: string
  reportId: string
  fileId: string
  expiresAt: number
  token: string
}): boolean {
  if (params.expiresAt * 1000 < Date.now()) return false
  const payload = `comment-image:${params.projectId}:${params.reportId}:${params.fileId}:${params.expiresAt}`
  // Accept the current secret and any retired ones (ATTACHMENT_URL_SECRET_PREVIOUS)
  // so a rotation does not break images already pasted into synced comments.
  // Every candidate is checked so timing does not reveal which one matched.
  let ok = false
  for (const secret of getAttachmentVerifySecrets()) {
    const expected = createHmac("sha256", secret).update(payload).digest("hex")
    if (expected.length !== params.token.length) continue
    try {
      if (timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(params.token, "hex"))) ok = true
    } catch {
      // malformed hex in token — treat as mismatch
    }
  }
  return ok
}

export default defineEventHandler(async (event): Promise<Buffer> => {
  const projectId = getRouterParam(event, "id")
  const reportId = getRouterParam(event, "reportId")
  const fileId = getRouterParam(event, "fileId")
  if (!projectId || !reportId || !fileId) {
    throw createError({ statusCode: 400, statusMessage: "missing params" })
  }
  if (!FILE_ID_RE.test(fileId)) {
    throw createError({ statusCode: 400, statusMessage: "Invalid file id" })
  }

  const q = getQuery(event)
  const tokenRaw = q.token
  const expiresRaw = q.expires
  const usedToken = typeof tokenRaw === "string" && typeof expiresRaw === "string"
  if (usedToken) {
    const expiresAt = Number.parseInt(expiresRaw as string, 10)
    if (!Number.isFinite(expiresAt)) {
      throw createError({ statusCode: 401, statusMessage: "Invalid token" })
    }
    if (
      !verifyToken({
        projectId,
        reportId,
        fileId,
        expiresAt,
        token: tokenRaw as string,
      })
    ) {
      throw createError({ statusCode: 401, statusMessage: "Invalid or expired token" })
    }
  } else {
    await requireProjectRole(event, projectId, "viewer")
  }

  const storage = await getStorage()
  const storageKey = `comment-uploads/${projectId}/${reportId}/${fileId}`

  let bytes: Uint8Array
  try {
    const result = await storage.get(storageKey)
    bytes = result.bytes
  } catch {
    throw createError({ statusCode: 404, statusMessage: "Image not found" })
  }

  const ext = (fileId.split(".").pop() ?? "").toLowerCase()
  const contentType = EXT_TO_TYPE[ext] ?? "application/octet-stream"

  setHeader(event, "Content-Type", contentType)
  // Public-cacheable when fetched via signed token — GitHub camo benefits
  // from this, and the bytes are immutable for a given fileId. When fetched
  // via session auth, fall back to private caching.
  setHeader(
    event,
    "Cache-Control",
    usedToken ? "public, max-age=86400, immutable" : "private, max-age=3600, immutable",
  )
  setHeader(event, "X-Content-Type-Options", "nosniff")
  // Lock the rendered context to image-only. Even if a malformed PNG smuggled
  // HTML, the sandbox CSP prevents script execution.
  setHeader(event, "Content-Security-Policy", "default-src 'none'; img-src 'self' data:; sandbox")
  return Buffer.from(bytes)
})
