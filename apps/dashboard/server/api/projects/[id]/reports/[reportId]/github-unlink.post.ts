// apps/dashboard/server/api/projects/[id]/reports/[reportId]/github-unlink.post.ts
import { createError, defineEventHandler, getRouterParam } from "h3"
import { db } from "../../../../../db"
import { unlinkReportFromGithubIssue } from "../../../../../lib/github-link"
import { requireProjectRole } from "../../../../../lib/permissions"

export default defineEventHandler(async (event) => {
  const projectId = getRouterParam(event, "id")
  const reportId = getRouterParam(event, "reportId")
  if (!projectId || !reportId)
    throw createError({ statusCode: 400, statusMessage: "missing params" })
  const { session } = await requireProjectRole(event, projectId, "manager")

  return await db.transaction(async (tx) =>
    unlinkReportFromGithubIssue(tx, {
      projectId,
      reportId,
      actorId: session.userId,
      actorClientId: null,
    }),
  )
})
