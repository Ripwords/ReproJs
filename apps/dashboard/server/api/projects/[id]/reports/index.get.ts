// apps/dashboard/server/api/projects/[id]/reports/index.get.ts
import { defineEventHandler, getQuery, getRouterParam } from "h3"
import {
  type SQL,
  and,
  arrayContains,
  count,
  desc,
  eq,
  ilike,
  inArray,
  or,
  sql,
  exists,
  notExists,
} from "drizzle-orm"
import {
  ReportPriority,
  ReportStatus,
  type ReportFacetsDTO,
  type ReportListDTO,
  type ReportSummaryDTO,
  type ReportContext,
} from "@reprojs/shared"
import { db } from "../../../../db"
import { reportAssignees, reportAttachments, reports } from "../../../../db/schema"
import { userIdentities } from "../../../../db/schema/user-identities"
import { buildSortClause, resolveAssigneeFilter } from "../../../../lib/inbox-query"
import { requireProjectRole } from "../../../../lib/permissions"

function parseCsv(v: unknown): string[] {
  if (typeof v !== "string") return []
  return v
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .slice(0, 10)
}

export default defineEventHandler(async (event): Promise<ReportListDTO> => {
  const id = getRouterParam(event, "id")
  if (!id) throw new Error("missing project id")
  const { session } = await requireProjectRole(event, id, "viewer")
  // Look up the session user's linked github login so the "assigned to me"
  // facet can filter on `report_assignees.github_login`. If the user hasn't
  // linked an identity, the "me" token is dropped downstream.
  const [sessionIdentity] = await db
    .select({ externalHandle: userIdentities.externalHandle })
    .from(userIdentities)
    .where(and(eq(userIdentities.userId, session.userId), eq(userIdentities.provider, "github")))
    .limit(1)
  const sessionGithubLogin = sessionIdentity?.externalHandle ?? null

  const q = getQuery(event)
  const limit = Math.min(100, Math.max(1, Number(q.limit ?? 50)))
  // Cap offset so `?offset=9999999999` can't force a whole-table scan. 100k
  // rows × a reasonable limit is already well past any human paging — deep
  // archaeology should switch to the filters, not pagination.
  const offset = Math.max(0, Math.min(Number(q.offset ?? 0), 100_000))
  const searchRaw = typeof q.q === "string" ? q.q.slice(0, 200).trim() : ""
  const orderBy = buildSortClause(typeof q.sort === "string" ? q.sort : "newest")

  const statusTokens = parseCsv(q.status).filter((v) => ReportStatus.safeParse(v).success)
  const priorityTokens = parseCsv(q.priority).filter((v) => ReportPriority.safeParse(v).success)
  const tagTokens = parseCsv(q.tag)
  const assigneeTokens = parseCsv(q.assignee)
  const sourceTokens = parseCsv(q.source).filter((v) =>
    ["web", "expo", "ios", "android"].includes(v),
  )
  const assigneeFilters = resolveAssigneeFilter(assigneeTokens, sessionGithubLogin)

  const whereParts: ReturnType<typeof eq>[] = [eq(reports.projectId, id)]
  if (statusTokens.length) whereParts.push(inArray(reports.status, statusTokens as ReportStatus[]))
  if (priorityTokens.length)
    whereParts.push(inArray(reports.priority, priorityTokens as ReportPriority[]))
  if (tagTokens.length) whereParts.push(arrayContains(reports.tags, tagTokens))
  if (assigneeFilters.length) {
    const logins = assigneeFilters.filter((f) => f.type === "login").map((f) => f.login)
    const wantUnassigned = assigneeFilters.some((f) => f.type === "null")
    const parts: ReturnType<typeof eq>[] = []
    if (logins.length) {
      parts.push(
        exists(
          db
            .select({ one: sql<number>`1` })
            .from(reportAssignees)
            .where(
              and(
                eq(reportAssignees.reportId, reports.id),
                inArray(reportAssignees.githubLogin, logins),
              ),
            ),
        ),
      )
    }
    if (wantUnassigned) {
      parts.push(
        notExists(
          db
            .select({ one: sql<number>`1` })
            .from(reportAssignees)
            .where(eq(reportAssignees.reportId, reports.id)),
        ),
      )
    }
    if (parts.length === 1 && parts[0]) whereParts.push(parts[0])
    else if (parts.length > 1) {
      const combined = or(...parts)
      if (combined) whereParts.push(combined)
    }
  }
  if (searchRaw) {
    const pat = `%${searchRaw}%`
    const searchCondition = or(ilike(reports.title, pat), ilike(reports.description, pat))
    if (searchCondition) whereParts.push(searchCondition)
  }
  if (sourceTokens.length) {
    const orParts: SQL[] = []
    if (sourceTokens.includes("web")) orParts.push(eq(reports.source, "web"))
    if (sourceTokens.includes("expo")) orParts.push(eq(reports.source, "expo"))
    if (sourceTokens.includes("ios")) {
      const clause = and(eq(reports.source, "expo"), eq(reports.devicePlatform, "ios"))
      if (clause) orParts.push(clause)
    }
    if (sourceTokens.includes("android")) {
      const clause = and(eq(reports.source, "expo"), eq(reports.devicePlatform, "android"))
      if (clause) orParts.push(clause)
    }
    if (orParts.length > 0) {
      const combined = or(...orParts)
      if (combined) whereParts.push(combined)
    }
  }

  const whereClause = and(...whereParts)

  // Count, main fetch, and facets all use the same whereClause — run concurrently.
  const [countResult, rows, statusRows, priorityRows, assigneeFacetRows, tagRows, sourceFacetRows] =
    await Promise.all([
      db.select({ total: count() }).from(reports).where(whereClause),
      db
        .select({
          id: reports.id,
          title: reports.title,
          description: reports.description,
          context: reports.context,
          createdAt: reports.createdAt,
          updatedAt: reports.updatedAt,
          status: reports.status,
          priority: reports.priority,
          tags: reports.tags,
          source: reports.source,
          devicePlatform: reports.devicePlatform,
          attachmentId: reportAttachments.id,
          githubIssueNumber: reports.githubIssueNumber,
          githubIssueUrl: reports.githubIssueUrl,
          milestoneNumber: reports.milestoneNumber,
          milestoneTitle: reports.milestoneTitle,
        })
        .from(reports)
        .leftJoin(
          reportAttachments,
          and(eq(reportAttachments.reportId, reports.id), eq(reportAttachments.kind, "screenshot")),
        )
        .where(whereClause)
        .orderBy(...orderBy)
        .limit(limit)
        .offset(offset),
      db
        .select({ key: reports.status, c: count() })
        .from(reports)
        .where(whereClause)
        .groupBy(reports.status),
      db
        .select({ key: reports.priority, c: count() })
        .from(reports)
        .where(whereClause)
        .groupBy(reports.priority),
      // Assignee facet: distinct reports per github-login within project scope.
      // We derive avatar from the max-seen avatar url for that login so a
      // single stale row doesn't null out the picture for everyone.
      db
        .select({
          login: reportAssignees.githubLogin,
          avatarUrl: sql<string | null>`max(${reportAssignees.githubAvatarUrl})`,
          c: sql<number>`count(distinct ${reportAssignees.reportId})`,
        })
        .from(reportAssignees)
        .innerJoin(reports, eq(reports.id, reportAssignees.reportId))
        .where(eq(reports.projectId, id))
        .groupBy(reportAssignees.githubLogin),
      db
        .select({ name: sql<string>`unnest(${reports.tags})`.as("name"), c: count() })
        .from(reports)
        .where(whereClause)
        .groupBy(sql`name`)
        .orderBy(desc(count()))
        .limit(20),
      // Source facets use only the project-id filter so counts are stable
      // regardless of what other filters are active (standard facet UX).
      db
        .select({
          source: reports.source,
          devicePlatform: reports.devicePlatform,
          c: count(),
        })
        .from(reports)
        .where(and(eq(reports.projectId, id)))
        .groupBy(reports.source, reports.devicePlatform),
    ])
  const total = countResult[0]?.total ?? 0

  // Determine which of the returned reports have a replay attachment.
  const reportIds = rows.map((r) => r.id)
  const replaySet = new Set<string>()

  // Load assignees for all returned reports (github-only)
  const assigneeRowsForItems =
    reportIds.length > 0
      ? await db
          .select({
            reportId: reportAssignees.reportId,
            login: reportAssignees.githubLogin,
            avatarUrl: reportAssignees.githubAvatarUrl,
          })
          .from(reportAssignees)
          .where(inArray(reportAssignees.reportId, reportIds))
      : []

  const assigneesByReport = new Map<string, typeof assigneeRowsForItems>()
  for (const a of assigneeRowsForItems) {
    if (!a.login) continue
    const arr = assigneesByReport.get(a.reportId) ?? []
    arr.push(a)
    assigneesByReport.set(a.reportId, arr)
  }

  if (reportIds.length > 0) {
    const replayRows = await db
      .select({ reportId: reportAttachments.reportId })
      .from(reportAttachments)
      .where(
        and(inArray(reportAttachments.reportId, reportIds), eq(reportAttachments.kind, "replay")),
      )
    for (const rr of replayRows) replaySet.add(rr.reportId)
  }

  const items: ReportSummaryDTO[] = rows.map((r) => {
    const ctx = r.context as ReportContext
    const assignees = (assigneesByReport.get(r.id) ?? [])
      .filter((a): a is typeof a & { login: string } => a.login !== null)
      .map((a) => ({ login: a.login, avatarUrl: a.avatarUrl }))
    return {
      id: r.id,
      title: r.title,
      description: r.description ?? null,
      context: ctx,
      reporterEmail: ctx.reporter?.email ?? null,
      pageUrl: ctx.pageUrl,
      receivedAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      thumbnailUrl: r.attachmentId
        ? `/api/projects/${id}/reports/${r.id}/attachment?kind=screenshot`
        : null,
      hasReplay: replaySet.has(r.id),
      status: r.status,
      priority: r.priority,
      tags: r.tags,
      source: r.source,
      devicePlatform: r.devicePlatform ?? null,
      githubIssueNumber: r.githubIssueNumber ?? null,
      githubIssueUrl: r.githubIssueUrl ?? null,
      milestoneNumber: r.milestoneNumber ?? null,
      milestoneTitle: r.milestoneTitle ?? null,
      assignees,
    }
  })

  const statusFacet: ReportFacetsDTO["status"] = { open: 0, in_progress: 0, resolved: 0, closed: 0 }
  for (const r of statusRows) statusFacet[r.key] = r.c
  const priorityFacet: ReportFacetsDTO["priority"] = { low: 0, normal: 0, high: 0, urgent: 0 }
  for (const r of priorityRows) priorityFacet[r.key] = r.c

  const sourceFacets: ReportFacetsDTO["source"] = { web: 0, expo: 0, ios: 0, android: 0 }
  for (const r of sourceFacetRows) {
    if (r.source === "web") sourceFacets.web += r.c
    if (r.source === "expo") {
      sourceFacets.expo += r.c
      if (r.devicePlatform === "ios") sourceFacets.ios += r.c
      if (r.devicePlatform === "android") sourceFacets.android += r.c
    }
  }

  return {
    items,
    total,
    facets: {
      status: statusFacet,
      priority: priorityFacet,
      assignees: assigneeFacetRows
        .filter((r): r is typeof r & { login: string } => r.login !== null)
        .map((r) => ({ login: r.login, avatarUrl: r.avatarUrl, count: r.c })),
      tags: tagRows.map((r) => ({ name: r.name, count: r.c })),
      source: sourceFacets,
    },
  }
})
