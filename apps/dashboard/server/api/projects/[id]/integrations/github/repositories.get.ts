// apps/dashboard/server/api/projects/[id]/integrations/github/repositories.get.ts
import type { GithubRepositoryPageDTO } from "@reprojs/shared"
import { createError, defineEventHandler, getQuery, getRouterParam } from "h3"
import { eq } from "drizzle-orm"
import { z } from "zod"
import { db } from "../../../../../db"
import { githubIntegrations } from "../../../../../db/schema"
import { getGithubClient } from "../../../../../lib/github"
import { getInstallationRepos } from "../../../../../lib/github-cache"
import { requireProjectRole } from "../../../../../lib/permissions"

const querySchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  per_page: z.coerce.number().int().min(1).max(100).default(30),
  q: z.string().trim().max(200).optional(),
})

export default defineEventHandler(async (event): Promise<GithubRepositoryPageDTO> => {
  const projectId = getRouterParam(event, "id")
  if (!projectId) throw createError({ statusCode: 400, statusMessage: "missing project id" })
  await requireProjectRole(event, projectId, "developer")

  const parsed = querySchema.safeParse(getQuery(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: "invalid query params" })
  }
  const { page, per_page: perPage, q } = parsed.data

  const [gi] = await db
    .select()
    .from(githubIntegrations)
    .where(eq(githubIntegrations.projectId, projectId))
    .limit(1)

  if (!gi || gi.status !== "connected") {
    throw createError({ statusCode: 409, statusMessage: "integration not connected" })
  }

  const installationId = gi.installationId
  const all = await getInstallationRepos(installationId, async () => {
    const client = await getGithubClient(installationId)
    return client.listInstallationRepositories()
  })

  const needle = q?.toLowerCase()
  const filtered = needle ? all.filter((r) => r.fullName.toLowerCase().includes(needle)) : all

  const total = filtered.length
  const start = (page - 1) * perPage
  const end = start + perPage
  const repos = filtered.slice(start, end)

  return {
    repos,
    page,
    perPage,
    total,
    hasMore: end < total,
  }
})
