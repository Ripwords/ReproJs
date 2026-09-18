// apps/dashboard/server/api/projects/[id]/integrations/github/assignable-users.get.ts
import type { GithubAssignableUserListDTO } from "@reprojs/shared"
import { createError, defineEventHandler, getQuery, getRouterParam } from "h3"
import { eq } from "drizzle-orm"
import { db } from "../../../../../db"
import { githubIntegrations } from "../../../../../db/schema/github-integrations"
import { requireProjectRole } from "../../../../../lib/permissions"
import { getGithubClient } from "../../../../../lib/github"
import { githubCache, cacheKey } from "../../../../../lib/github-cache"
import { resolveGithubUsers } from "../../../../../lib/github-identities"

export default defineEventHandler(async (event): Promise<GithubAssignableUserListDTO> => {
  const projectId = getRouterParam(event, "id")
  if (!projectId) throw createError({ statusCode: 400, statusMessage: "Missing project id" })
  await requireProjectRole(event, projectId, "viewer")

  const query = getQuery(event)
  const q = typeof query.q === "string" ? query.q.trim().toLowerCase() : ""

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
    "assignees",
  )
  const rawItems = await githubCache.get(key, async () => {
    const client = await getGithubClient(integration.installationId)
    return client.listAssignableUsers(integration.repoOwner, integration.repoName)
  })

  const linkedMap = await resolveGithubUsers(rawItems.map((i) => i.githubUserId))

  const items = rawItems
    .map((u) => ({
      githubUserId: u.githubUserId,
      login: u.login,
      avatarUrl: u.avatarUrl,
      linkedUser: linkedMap.get(u.githubUserId) ?? null,
    }))
    .filter((u) => {
      if (!q) return true
      const loginMatch = u.login.toLowerCase().includes(q)
      const nameMatch = u.linkedUser?.name?.toLowerCase().includes(q) ?? false
      return loginMatch || nameMatch
    })
    .toSorted((a, b) => {
      const aLinked = a.linkedUser ? 0 : 1
      const bLinked = b.linkedUser ? 0 : 1
      if (aLinked !== bLinked) return aLinked - bLinked
      return a.login.localeCompare(b.login)
    })

  return { items }
})
