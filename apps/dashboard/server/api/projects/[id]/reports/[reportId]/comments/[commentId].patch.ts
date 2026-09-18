// apps/dashboard/server/api/projects/[id]/reports/[reportId]/comments/[commentId].patch.ts
import { createError, defineEventHandler, getRouterParam, readValidatedBody } from "h3"
import { and, eq, isNull } from "drizzle-orm"
import { z } from "zod"
import { db } from "../../../../../../db"
import { reportComments } from "../../../../../../db/schema/report-comments"
import { reports } from "../../../../../../db/schema/reports"
import { requireProjectRole } from "../../../../../../lib/permissions"
import { publishReportStream } from "../../../../../../lib/report-events-bus"
import { enqueueCommentUpsert } from "../../../../../../lib/enqueue-sync"

const UpdateCommentBody = z.object({
  body: z.string().min(1).max(65_536),
})

export default defineEventHandler(async (event) => {
  const projectId = getRouterParam(event, "id")
  const reportId = getRouterParam(event, "reportId")
  const commentId = getRouterParam(event, "commentId")
  if (!projectId || !reportId || !commentId) {
    throw createError({ statusCode: 400, statusMessage: "Missing ids" })
  }

  const { session } = await requireProjectRole(event, projectId, "manager")
  const body = await readValidatedBody(event, (b) => UpdateCommentBody.parse(b))

  const [comment] = await db
    .select()
    .from(reportComments)
    .where(
      and(
        eq(reportComments.id, commentId),
        eq(reportComments.reportId, reportId),
        isNull(reportComments.deletedAt),
      ),
    )
    .limit(1)

  if (!comment) throw createError({ statusCode: 404, statusMessage: "Comment not found" })

  // Author-only. An edit keeps the original attribution and syncs to GitHub
  // under it, so letting anyone else (owners included) rewrite the body would
  // put words in the author's mouth. GitHub-originated comments have no
  // dashboard author (userId null) and are never editable here.
  const isAuthor = comment.userId !== null && comment.userId === session.userId
  if (!isAuthor) {
    throw createError({ statusCode: 403, statusMessage: "Insufficient permission" })
  }

  const [updated] = await db
    .update(reportComments)
    .set({ body: body.body, updatedAt: new Date() })
    .where(eq(reportComments.id, commentId))
    .returning()

  // If the comment has already been synced to GitHub, enqueue an update
  if (comment.githubCommentId !== null) {
    const [report] = await db
      .select({ projectId: reports.projectId })
      .from(reports)
      .where(eq(reports.id, reportId))
      .limit(1)
    if (report) {
      await enqueueCommentUpsert(reportId, commentId)
    }
  }

  publishReportStream(reportId, {
    kind: "comment_edited",
    payload: { commentId },
  })

  return { comment: updated }
})
