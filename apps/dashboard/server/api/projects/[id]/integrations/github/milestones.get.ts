// apps/dashboard/server/api/projects/[id]/integrations/github/milestones.get.ts
import type { GithubMilestoneListDTO } from "@reprojs/shared"
import { createError, defineEventHandler, getQuery, getRouterParam } from "h3"
import { eq } from "drizzle-orm"
import { db } from "../../../../../db"
import { githubIntegrations } from "../../../../../db/schema/github-integrations"
import { requireProjectRole } from "../../../../../lib/permissions"
import { getGithubClient } from "../../../../../lib/github"
import { githubCache, cacheKey } from "../../../../../lib/github-cache"

export default defineEventHandler(async (event): Promise<GithubMilestoneListDTO> => {
  const projectId = getRouterParam(event, "id")
  if (!projectId) throw createError({ statusCode: 400, statusMessage: "Missing project id" })
  await requireProjectRole(event, projectId, "viewer")

  const query = getQuery(event)
  const state = query.state === "all" ? "all" : "open"

  const [integration] = await db
    .select()
    .from(githubIntegrations)
    .where(eq(githubIntegrations.projectId, projectId))
    .limit(1)

  if (
    !integration ||
    integration.status !== "connected" ||
    !integration.repoOwner ||
    !integration.repoName
  ) {
    throw createError({ statusCode: 409, statusMessage: "GitHub integration is not connected" })
  }

  const resource = state === "all" ? "milestones-all" : "milestones-open"
  const key = cacheKey(
    Number(integration.installationId),
    integration.repoOwner,
    integration.repoName,
    resource,
  )
  const items = await githubCache.get(key, async () => {
    const client = await getGithubClient(integration.installationId)
    return client.listMilestones(integration.repoOwner, integration.repoName, state)
  })

  return { items }
})
