// apps/dashboard/server/api/projects/[id]/integrations/github/issues/[number].get.ts
//
// GET /api/projects/:id/integrations/github/issues/:number
// Preview of one issue in the project's repo (title, state, labels) so the
// attach dialog can show the manager what they are about to attach to.
// 404 when the number does not exist or names a pull request.
import type { GithubIssueSummaryDTO } from "@reprojs/shared"
import { MAX_ISSUE_NUMBER } from "@reprojs/shared"
import { createError, defineEventHandler, getRouterParam } from "h3"
import { requireProjectRole } from "../../../../../../lib/permissions"
import {
  loadGithubIssue,
  requireConnectedRepo,
  toIssueSummaryDTO,
} from "../../../../../../lib/github-attach"

export default defineEventHandler(async (event): Promise<GithubIssueSummaryDTO> => {
  const projectId = getRouterParam(event, "id")
  const rawNumber = getRouterParam(event, "number")
  if (!projectId || !rawNumber) {
    throw createError({ statusCode: 400, statusMessage: "missing params" })
  }
  await requireProjectRole(event, projectId, "manager")

  const issueNumber = /^\d+$/.test(rawNumber) ? Number(rawNumber) : NaN
  if (!Number.isSafeInteger(issueNumber) || issueNumber < 1 || issueNumber > MAX_ISSUE_NUMBER) {
    throw createError({ statusCode: 400, statusMessage: "Invalid issue number" })
  }

  const integration = await requireConnectedRepo(projectId)
  const issue = await loadGithubIssue(integration, issueNumber)
  return toIssueSummaryDTO(issue)
})
