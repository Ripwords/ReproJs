// apps/dashboard/server/api/projects/[id]/integrations/github/issues.get.ts
//
// GET /api/projects/:id/integrations/github/issues?q=&state=open&page=1
// Issues of the project's configured repo for the "attach to existing issue"
// picker. Manager+ with a dashboard session only: embed-key holders (widget,
// extension) can never reach this, so the repo's issue list stays private.
import type { GithubIssueListDTO } from "@reprojs/shared"
import { createError, defineEventHandler, getQuery, getRouterParam } from "h3"
import { z } from "zod"
import { requireProjectRole } from "../../../../../lib/permissions"
import { getGithubClient } from "../../../../../lib/github"
import { requireConnectedRepo, toIssueSummaryDTO } from "../../../../../lib/github-attach"

const Query = z.object({
  q: z.string().trim().max(200).optional(),
  state: z.enum(["open", "closed", "all"]).default("open"),
  page: z.coerce.number().int().min(1).max(100).default(1),
})

export default defineEventHandler(async (event): Promise<GithubIssueListDTO> => {
  const projectId = getRouterParam(event, "id")
  if (!projectId) throw createError({ statusCode: 400, statusMessage: "Missing project id" })
  await requireProjectRole(event, projectId, "manager")

  const query = Query.safeParse(getQuery(event))
  if (!query.success) {
    throw createError({ statusCode: 400, statusMessage: "Invalid query" })
  }

  const integration = await requireConnectedRepo(projectId)
  const client = await getGithubClient(integration.installationId)
  const issues = await client.listIssues({
    owner: integration.repoOwner,
    repo: integration.repoName,
    state: query.data.state,
    q: query.data.q,
    page: query.data.page,
    perPage: 30,
  })
  return { items: issues.map(toIssueSummaryDTO) }
})
