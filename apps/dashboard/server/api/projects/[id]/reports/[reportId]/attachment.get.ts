import {
  createError,
  defineEventHandler,
  getQuery,
  getRouterParam,
  setHeader,
  setResponseStatus,
} from "h3"
import { and, eq } from "drizzle-orm"
import { db } from "../../../../../db"
import { reportAttachments, reports } from "../../../../../db/schema"
import { getAttachmentVerifySecrets } from "../../../../../lib/env"
import { requireProjectRole } from "../../../../../lib/permissions"
import { getStorage } from "../../../../../lib/storage"
import { verifyAttachmentTokenAny } from "../../../../../lib/signed-attachment-url"

export default defineEventHandler(async (event) => {
  const projectId = getRouterParam(event, "id")
  const reportId = getRouterParam(event, "reportId")
  if (!projectId || !reportId) {
    throw createError({ statusCode: 400, statusMessage: "missing params" })
  }

  const q = getQuery(event)
  const kindRaw = q.kind
  const kind = typeof kindRaw === "string" ? kindRaw : "screenshot"
  const idRaw = q.id

  // Signed-token fast path: used by GitHub-embedded screenshot URLs, no session.
  const tokenRaw = q.token
  const expiresRaw = q.expires
  const usedToken = typeof tokenRaw === "string" && typeof expiresRaw === "string"
  if (usedToken) {
    const expiresAt = Number.parseInt(expiresRaw as string, 10)
    if (!Number.isFinite(expiresAt)) {
      throw createError({ statusCode: 401, statusMessage: "Invalid token" })
    }
    const ok = verifyAttachmentTokenAny({
      secrets: getAttachmentVerifySecrets(),
      projectId,
      reportId,
      kind,
      expiresAt,
      token: tokenRaw as string,
    })
    if (!ok) {
      throw createError({ statusCode: 401, statusMessage: "Invalid or expired token" })
    }
  } else {
    await requireProjectRole(event, projectId, "viewer")
  }

  // ?id=<uuid> path: fetch any attachment row directly by primary key.
  // Used for user-file attachments which may have any content type.
  // Tokens are scoped by (project, report, kind, expiry) — they MUST NOT be
  // combined with ?id=<uuid> to fetch arbitrary attachments by primary key,
  // or a token minted for one kind could be replayed against any attachment
  // in the same report.
  if (typeof idRaw === "string") {
    if (usedToken) {
      throw createError({ statusCode: 401, statusMessage: "Token cannot be used with ?id=" })
    }
    const [row] = await db
      .select({
        storageKey: reportAttachments.storageKey,
        contentType: reportAttachments.contentType,
        kind: reportAttachments.kind,
        filename: reportAttachments.filename,
      })
      .from(reportAttachments)
      .innerJoin(reports, eq(reports.id, reportAttachments.reportId))
      .where(
        and(
          eq(reportAttachments.id, idRaw),
          eq(reportAttachments.reportId, reportId),
          eq(reports.projectId, projectId),
        ),
      )
      .limit(1)

    if (!row) throw createError({ statusCode: 404, statusMessage: "Attachment not found" })

    const storage = await getStorage()
    const { bytes } = await storage.get(row.storageKey)

    // For user-file attachments, serve the stored content type directly.
    // For all others, use the kind-based allowlist for XSS protection.
    const KIND_TYPES: Record<string, string> = {
      screenshot: "image/png",
      "annotated-screenshot": "image/png",
      replay: "application/gzip",
      logs: "application/json",
    }
    const safeType = KIND_TYPES[row.kind] ?? row.contentType

    setHeader(event, "Content-Type", safeType)
    setHeader(event, "X-Content-Type-Options", "nosniff")
    setHeader(event, "Content-Security-Policy", "default-src 'none'; img-src 'self' data:; sandbox")
    setHeader(event, "Cache-Control", "private, max-age=3600")
    if (row.filename) {
      // Strip CR/LF in addition to escaping double-quotes; defense-in-depth
      // against header injection. sanitizeFilename already strips control
      // bytes at intake time, but never trust two layers down.
      const safeName = row.filename.replace(/[\r\n"]/g, "")
      // user-file kinds force `attachment` so a malicious file that somehow
      // slipped past the mime/ext denylist + virus scan still cannot render
      // inline in the browser. Other kinds (screenshot/replay/logs) are
      // already rendered via known-safe content types and stay inline.
      const disposition = row.kind === "user-file" ? "attachment" : "inline"
      setHeader(event, "Content-Disposition", `${disposition}; filename="${safeName}"`)
    }
    setResponseStatus(event, 200)
    return Buffer.from(bytes)
  }

  const [row] = await db
    .select({
      storageKey: reportAttachments.storageKey,
      contentType: reportAttachments.contentType,
    })
    .from(reportAttachments)
    .innerJoin(reports, eq(reports.id, reportAttachments.reportId))
    .where(
      and(
        eq(reportAttachments.reportId, reportId),
        eq(
          reportAttachments.kind,
          kind as "screenshot" | "annotated-screenshot" | "replay" | "logs",
        ),
        eq(reports.projectId, projectId),
      ),
    )
    .limit(1)

  if (!row) throw createError({ statusCode: 404, statusMessage: "Attachment not found" })

  const storage = await getStorage()
  const { bytes, contentType } = await storage.get(row.storageKey)

  // Allowlist the content type: never serve what was stored if it's not one of
  // the kinds the intake endpoint legitimately writes. This blocks stored-XSS
  // via a spoofed text/html content type regardless of what lands on disk.
  const SAFE_CONTENT_TYPES: Record<string, string> = {
    screenshot: "image/png",
    "annotated-screenshot": "image/png",
    replay: "application/gzip",
    logs: "application/json",
  }
  const safeType = SAFE_CONTENT_TYPES[kind] ?? "application/octet-stream"

  setHeader(event, "Content-Type", safeType)
  setHeader(event, "X-Content-Type-Options", "nosniff")
  setHeader(event, "Content-Security-Policy", "default-src 'none'; img-src 'self' data:; sandbox")
  setHeader(event, "Cache-Control", "private, max-age=3600")
  setResponseStatus(event, 200)
  // Mark `contentType` intentionally unused — we allowlist the served type.
  void contentType
  return Buffer.from(bytes)
})
