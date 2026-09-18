// apps/dashboard/server/api/projects/[id]/integrations/github/labels.get.ts
import type { GithubRepoLabelListDTO } from "@reprojs/shared"
import { createError, defineEventHandler, getRouterParam } from "h3"
import { eq } from "drizzle-orm"
import { db } from "../../../../../db"
import { githubIntegrations } from "../../../../../db/schema/github-integrations"
import { requireProjectRole } from "../../../../../lib/permissions"
import { getGithubClient } from "../../../../../lib/github"
import { githubCache, cacheKey } from "../../../../../lib/github-cache"

export default defineEventHandler(async (event): Promise<GithubRepoLabelListDTO> => {
  const projectId = getRouterParam(event, "id")
  if (!projectId) throw createError({ statusCode: 400, statusMessage: "Missing project id" })
  await requireProjectRole(event, projectId, "viewer")

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

  const key = cacheKey(
    Number(integration.installationId),
    integration.repoOwner,
    integration.repoName,
    "labels",
  )
  const items = await githubCache.get(key, async () => {
    const client = await getGithubClient(integration.installationId)
    return client.listRepoLabels(integration.repoOwner, integration.repoName)
  })

  return { items }
})
