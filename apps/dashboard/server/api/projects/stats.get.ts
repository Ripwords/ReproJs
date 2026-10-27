import { defineEventHandler } from "h3"
import { and, eq, isNull, sql } from "drizzle-orm"
import type { ProjectStatsDTO } from "@reprojs/shared"
import { db } from "../../db"
import { githubIntegrations, projectMembers, projects, reports } from "../../db/schema"
import { requireSession } from "../../lib/permissions"

const DAY_MS = 86_400_000
const WINDOW_DAYS = 7

/**
 * At-a-glance numbers for every project the caller can see, for the projects
 * grid. Kept separate from GET /api/projects so the sidebar and command
 * palette, which only need names, do not pay for the aggregate.
 */
export default defineEventHandler(async (event): Promise<ProjectStatsDTO[]> => {
  const session = await requireSession(event)
  const since = new Date(Date.now() - WINDOW_DAYS * DAY_MS)

  const visible =
    session.role === "admin"
      ? isNull(projects.deletedAt)
      : and(
          isNull(projects.deletedAt),
          sql`exists (select 1 from ${projectMembers} where ${projectMembers.projectId} = ${projects.id} and ${projectMembers.userId} = ${session.userId})`,
        )

  const rows = await db
    .select({
      projectId: projects.id,
      openCount: sql<number>`coalesce(sum(case when ${reports.status} = 'open' then 1 else 0 end), 0)::int`,
      inProgressCount: sql<number>`coalesce(sum(case when ${reports.status} = 'in_progress' then 1 else 0 end), 0)::int`,
      newLast7Count: sql<number>`coalesce(sum(case when ${reports.createdAt} >= ${since} then 1 else 0 end), 0)::int`,
      totalCount: sql<number>`count(${reports.id})::int`,
      // Decode through the column's own mapper: a raw `timestamp` string
      // would otherwise be parsed as local time.
      lastReportAt: sql<Date | null>`max(${reports.createdAt})`.mapWith(reports.createdAt),
      repoOwner: githubIntegrations.repoOwner,
      repoName: githubIntegrations.repoName,
      githubStatus: githubIntegrations.status,
    })
    .from(projects)
    .leftJoin(reports, eq(reports.projectId, projects.id))
    .leftJoin(githubIntegrations, eq(githubIntegrations.projectId, projects.id))
    .where(visible)
    .groupBy(
      projects.id,
      githubIntegrations.repoOwner,
      githubIntegrations.repoName,
      githubIntegrations.status,
    )

  return rows.map((r) => ({
    projectId: r.projectId,
    openCount: r.openCount,
    inProgressCount: r.inProgressCount,
    newLast7Count: r.newLast7Count,
    totalCount: r.totalCount,
    lastReportAt: r.lastReportAt ? r.lastReportAt.toISOString() : null,
    github:
      r.githubStatus === "connected" && r.repoOwner && r.repoName
        ? { repoOwner: r.repoOwner, repoName: r.repoName }
        : null,
  }))
})
