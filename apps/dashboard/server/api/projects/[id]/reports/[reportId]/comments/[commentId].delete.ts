// apps/dashboard/server/api/projects/[id]/reports/[reportId]/comments/[commentId].delete.ts
import { createError, defineEventHandler, getRouterParam, setResponseStatus } from "h3"
import { and, eq, isNull } from "drizzle-orm"
import { db } from "../../../../../../db"
import { reportComments } from "../../../../../../db/schema/report-comments"
import { reportSyncJobs } from "../../../../../../db/schema/github-integrations"
import { requireProjectRole } from "../../../../../../lib/permissions"
import { publishReportStream } from "../../../../../../lib/report-events-bus"
import { enqueueCommentDelete } from "../../../../../../lib/enqueue-sync"

// Kept in sync with signatureCommentUpsert() in enqueue-sync.ts — scoped here
// just to cancel the pending row by composite key when a never-pushed comment
// is deleted. If the signature format ever changes, update both places.
const commentUpsertSignature = (commentId: string): string => `comment_upsert:${commentId}`

export default defineEventHandler(async (event) => {
  const projectId = getRouterParam(event, "id")
  const reportId = getRouterParam(event, "reportId")
  const commentId = getRouterParam(event, "commentId")
  if (!projectId || !reportId || !commentId) {
    throw createError({ statusCode: 400, statusMessage: "Missing ids" })
  }

  const { session } = await requireProjectRole(event, projectId, "manager")

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

  // Author-only. A delete also removes the comment on GitHub when synced, and
  // no dashboard UI offers moderator deletes, so there is no owner override.
  // GitHub-originated comments (userId null) are never deletable here.
  const isAuthor = comment.userId !== null && comment.userId === session.userId
  if (!isAuthor) {
    throw createError({ statusCode: 403, statusMessage: "Insufficient permission" })
  }

  // Soft-delete
  await db
    .update(reportComments)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(reportComments.id, commentId))

  if (comment.githubCommentId !== null) {
    // If linked to GitHub → enqueue a delete job
    await enqueueCommentDelete(reportId, commentId, comment.githubCommentId)
  } else {
    // Not yet synced: if there's a pending upsert job for this specific
    // comment, drop it so we don't push a comment that was immediately
    // deleted. Scope to the exact signature so unrelated pending work
    // (reconcile, other comment upserts) is untouched.
    await db
      .delete(reportSyncJobs)
      .where(
        and(
          eq(reportSyncJobs.reportId, reportId),
          eq(reportSyncJobs.signature, commentUpsertSignature(commentId)),
        ),
      )
  }

  publishReportStream(reportId, {
    kind: "comment_deleted",
    payload: { commentId },
  })

  setResponseStatus(event, 204)
  return null
})
