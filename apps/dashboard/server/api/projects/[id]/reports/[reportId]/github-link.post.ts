// apps/dashboard/server/api/projects/[id]/reports/[reportId]/github-link.post.ts
//
// POST /api/projects/:id/reports/:reportId/github-link  body: { issueNumber }
// Attach a report to an issue that already exists in the project's repo. The
// issue is verified through the App installation first; the report then
// follows the issue and the reconciler posts the report body as one comment.
import { LinkGithubIssueBody } from "@reprojs/shared"
import { createError, defineEventHandler, getRouterParam, readBody } from "h3"
import { attachReportToGithubIssue } from "../../../../../lib/github-attach"
import { requireProjectRole } from "../../../../../lib/permissions"

export default defineEventHandler(async (event) => {
  const projectId = getRouterParam(event, "id")
  const reportId = getRouterParam(event, "reportId")
  if (!projectId || !reportId) {
    throw createError({ statusCode: 400, statusMessage: "missing params" })
  }
  const { session } = await requireProjectRole(event, projectId, "manager")

  const body = LinkGithubIssueBody.safeParse(await readBody(event))
  if (!body.success) {
    throw createError({ statusCode: 400, statusMessage: "Invalid body" })
  }

  return attachReportToGithubIssue({
    projectId,
    reportId,
    actorId: session.userId,
    actorClientId: null,
    issueNumber: body.data.issueNumber,
  })
})
