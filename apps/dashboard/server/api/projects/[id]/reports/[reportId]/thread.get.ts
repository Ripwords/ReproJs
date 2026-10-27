// apps/dashboard/server/api/projects/[id]/reports/[reportId]/thread.get.ts
//
// The thread of reports linked to the same GitHub issue as this one. A project
// maps to one repo, so "same issue" is same project + same issue number — the
// rule the webhook fan-out uses (findLinkedReports).
import { createError, defineEventHandler, getRouterParam } from "h3"
import { and, asc, eq, sql } from "drizzle-orm"
import type { ReportContext, ReportThreadDTO } from "@reprojs/shared"
import { db } from "../../../../../db"
import { reports } from "../../../../../db/schema"
import { requireProjectRole } from "../../../../../lib/permissions"

/** Enough for any real thread; keeps a runaway issue from returning thousands of rows. */
const THREAD_LIMIT = 100

export default defineEventHandler(async (event): Promise<ReportThreadDTO> => {
  const projectId = getRouterParam(event, "id")
  const reportId = getRouterParam(event, "reportId")
  if (!projectId || !reportId) {
    throw createError({ statusCode: 400, statusMessage: "missing params" })
  }
  await requireProjectRole(event, projectId, "viewer")

  const [current] = await db
    .select({ issueNumber: reports.githubIssueNumber, issueUrl: reports.githubIssueUrl })
    .from(reports)
    .where(and(eq(reports.id, reportId), eq(reports.projectId, projectId)))
    .limit(1)
  if (!current) {
    throw createError({ statusCode: 404, statusMessage: "Report not found" })
  }
  if (current.issueNumber === null) {
    return { issueNumber: null, issueUrl: null, items: [] }
  }

  const rows = await db
    .select({
      id: reports.id,
      title: reports.title,
      status: reports.status,
      priority: reports.priority,
      context: reports.context,
      createdAt: reports.createdAt,
      githubLinkKind: reports.githubLinkKind,
    })
    .from(reports)
    .where(
      and(eq(reports.projectId, projectId), eq(reports.githubIssueNumber, current.issueNumber)),
    )
    // The report that opened the issue is the thread's root, like the
    // webhook's pickCommentTarget; everything else follows oldest first.
    .orderBy(
      sql`CASE WHEN ${reports.githubLinkKind} = 'created' THEN 0 ELSE 1 END`,
      asc(reports.createdAt),
      asc(reports.id),
    )
    .limit(THREAD_LIMIT)

  return {
    issueNumber: current.issueNumber,
    issueUrl: current.issueUrl ?? null,
    items: rows.map((r) => {
      const reporter = (r.context as ReportContext).reporter
      return {
        id: r.id,
        title: r.title,
        status: r.status,
        priority: r.priority,
        reporterName: reporter?.name ?? null,
        reporterEmail: reporter?.email ?? null,
        receivedAt: r.createdAt.toISOString(),
        githubLinkKind: r.githubLinkKind ?? null,
      }
    }),
  }
})
