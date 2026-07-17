// apps/dashboard/server/api/projects/[id]/reports/[reportId]/media/[attachmentId].get.ts
//
// Session-authed Range-streaming blob for a report's kind="media" gallery
// attachments (images + trimmed video from the widget gallery/recording
// flow). Mirrors the shared-media blob route's Range semantics (Task 13)
// but is scoped to a project member instead of a public share token.
import {
  createError,
  defineEventHandler,
  getHeader,
  getRouterParam,
  sendStream,
  setHeader,
  setResponseStatus,
} from "h3"
import { and, eq } from "drizzle-orm"
import { db } from "../../../../../../db"
import { reportAttachments, reports } from "../../../../../../db/schema"
import { parseRangeHeader } from "../../../../../../lib/range"
import { requireProjectRole } from "../../../../../../lib/permissions"
import { getStorage } from "../../../../../../lib/storage"

// Same allowlist the intake route accepts for `media[N]` parts. Never trust
// the stored content_type directly — allowlisting blocks stored-XSS via a
// spoofed content type regardless of what landed in storage.
const MEDIA_CONTENT_TYPES: Record<string, string> = {
  "image/png": "image/png",
  "image/jpeg": "image/jpeg",
  "image/webp": "image/webp",
  "video/webm": "video/webm",
  "video/mp4": "video/mp4",
}

export default defineEventHandler(async (event) => {
  const projectId = getRouterParam(event, "id")
  const reportId = getRouterParam(event, "reportId")
  const attachmentId = getRouterParam(event, "attachmentId")
  if (!projectId || !reportId || !attachmentId) {
    throw createError({ statusCode: 400, statusMessage: "missing params" })
  }

  await requireProjectRole(event, projectId, "viewer")

  // The row must belong to this report, be kind="media", AND the report
  // must belong to this project — same ownership check attachment.get.ts
  // does via the join, so a viewer on project A can't fetch a media
  // attachment id that happens to belong to a report on project B.
  const [row] = await db
    .select({
      storageKey: reportAttachments.storageKey,
      contentType: reportAttachments.contentType,
      sizeBytes: reportAttachments.sizeBytes,
    })
    .from(reportAttachments)
    .innerJoin(reports, eq(reports.id, reportAttachments.reportId))
    .where(
      and(
        eq(reportAttachments.id, attachmentId),
        eq(reportAttachments.reportId, reportId),
        eq(reportAttachments.kind, "media"),
        eq(reports.projectId, projectId),
      ),
    )
    .limit(1)

  if (!row) throw createError({ statusCode: 404, statusMessage: "Not found" })

  const storage = await getStorage()
  const range = parseRangeHeader(getHeader(event, "range"), row.sizeBytes)

  const safeType = MEDIA_CONTENT_TYPES[row.contentType] ?? "application/octet-stream"

  setHeader(event, "Accept-Ranges", "bytes")
  setHeader(event, "X-Content-Type-Options", "nosniff")
  setHeader(event, "Content-Type", safeType)
  setHeader(event, "Content-Disposition", "inline")
  setHeader(event, "Cache-Control", "private, max-age=3600")

  if (range === "unsatisfiable") {
    setHeader(event, "Content-Range", `bytes */${row.sizeBytes}`)
    throw createError({ statusCode: 416, statusMessage: "Range Not Satisfiable" })
  }

  const s = await storage.getStream(row.storageKey, range ?? undefined)
  if (range) {
    setResponseStatus(event, 206)
    setHeader(event, "Content-Range", `bytes ${s.start}-${s.end}/${s.totalBytes}`)
  }
  setHeader(event, "Content-Length", s.end - s.start + 1)
  return sendStream(event, s.stream)
})
