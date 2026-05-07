// apps/dashboard/server/api/projects/[id]/reports/[reportId]/comments/index.post.ts
import {
  createError,
  defineEventHandler,
  getRouterParam,
  readValidatedBody,
  setResponseStatus,
} from "h3"
import { z } from "zod"
import { db } from "../../../../../../db"
import {
  addReportComment,
  addReportCommentSideEffects,
} from "../../../../../../lib/comments-service"
import { requireProjectRole } from "../../../../../../lib/permissions"

const CreateCommentBody = z.object({
  body: z.string().min(1).max(65_536),
})

export default defineEventHandler(async (event) => {
  const projectId = getRouterParam(event, "id")
  const reportId = getRouterParam(event, "reportId")
  if (!projectId || !reportId) throw createError({ statusCode: 400, statusMessage: "Missing ids" })

  const { session } = await requireProjectRole(event, projectId, "manager")
  const { body } = await readValidatedBody(event, (b) => CreateCommentBody.parse(b))

  const result = await db.transaction(async (tx) =>
    addReportComment(tx, {
      projectId,
      reportId,
      actorId: session.userId,
      actorClientId: null,
      body,
    }),
  )

  await addReportCommentSideEffects({
    projectId,
    reportId,
    commentId: result.comment.id,
    githubIssueNumber: result.githubIssueNumber,
  })

  setResponseStatus(event, 201)
  return { comment: result.comment }
})
