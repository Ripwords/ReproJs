// apps/dashboard/server/api/projects/[id]/reports/[reportId]/index.get.ts
//
// Single-report detail endpoint. Returns ReportDetailDTO (a superset of
// ReportSummaryDTO) which includes the full attachments array so the report
// page can render image thumbnails and downloadable file chips.
import { createError, defineEventHandler, getRouterParam } from "h3"
import { and, eq } from "drizzle-orm"
import type { ReportContext, ReportDetailDTO } from "@reprojs/shared"
import { db } from "../../../../../db"
import { reportAssignees, reportAttachments, reports } from "../../../../../db/schema"
import { requireProjectRole } from "../../../../../lib/permissions"

export default defineEventHandler(async (event): Promise<ReportDetailDTO> => {
  const projectId = getRouterParam(event, "id")
  const reportId = getRouterParam(event, "reportId")
  if (!projectId || !reportId) {
    throw createError({ statusCode: 400, statusMessage: "missing params" })
  }
  await requireProjectRole(event, projectId, "viewer")

  const [row] = await db
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
      githubIssueNumber: reports.githubIssueNumber,
      githubIssueUrl: reports.githubIssueUrl,
      milestoneNumber: reports.milestoneNumber,
      milestoneTitle: reports.milestoneTitle,
    })
    .from(reports)
    .where(and(eq(reports.id, reportId), eq(reports.projectId, projectId)))
    .limit(1)

  if (!row) {
    throw createError({ statusCode: 404, statusMessage: "Report not found" })
  }

  // Parallel: screenshot thumbnail + replay existence + assignees + all attachments.
  // Mirrors how the list endpoint computes `thumbnailUrl` and `hasReplay`.
  const [screenshotRows, replayRows, assigneeRows, attachmentRows] = await Promise.all([
    db
      .select({ id: reportAttachments.id })
      .from(reportAttachments)
      .where(
        and(eq(reportAttachments.reportId, reportId), eq(reportAttachments.kind, "screenshot")),
      )
      .limit(1),
    db
      .select({ id: reportAttachments.id })
      .from(reportAttachments)
      .where(and(eq(reportAttachments.reportId, reportId), eq(reportAttachments.kind, "replay")))
      .limit(1),
    db
      .select({
        login: reportAssignees.githubLogin,
        avatarUrl: reportAssignees.githubAvatarUrl,
      })
      .from(reportAssignees)
      .where(eq(reportAssignees.reportId, reportId)),
    db
      .select({
        id: reportAttachments.id,
        kind: reportAttachments.kind,
        contentType: reportAttachments.contentType,
        sizeBytes: reportAttachments.sizeBytes,
        filename: reportAttachments.filename,
        scannedAt: reportAttachments.scannedAt,
        scanStatus: reportAttachments.scanStatus,
        scanEngine: reportAttachments.scanEngine,
        scanDurationMs: reportAttachments.scanDurationMs,
        durationMs: reportAttachments.durationMs,
        trimStartMs: reportAttachments.trimStartMs,
        trimEndMs: reportAttachments.trimEndMs,
      })
      .from(reportAttachments)
      .where(eq(reportAttachments.reportId, reportId)),
  ])

  const ctx = row.context as ReportContext

  return {
    id: row.id,
    title: row.title,
    description: row.description ?? null,
    context: ctx,
    reporterEmail: ctx.reporter?.email ?? null,
    pageUrl: ctx.pageUrl,
    thumbnailUrl:
      screenshotRows.length > 0
        ? `/api/projects/${projectId}/reports/${reportId}/attachment?kind=screenshot`
        : null,
    hasReplay: replayRows.length > 0,
    receivedAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    status: row.status,
    priority: row.priority,
    tags: row.tags,
    source: row.source,
    devicePlatform: row.devicePlatform ?? null,
    githubIssueNumber: row.githubIssueNumber ?? null,
    githubIssueUrl: row.githubIssueUrl ?? null,
    milestoneNumber: row.milestoneNumber ?? null,
    milestoneTitle: row.milestoneTitle ?? null,
    assignees: assigneeRows
      .filter((a): a is typeof a & { login: string } => a.login !== null)
      .map((a) => ({ login: a.login, avatarUrl: a.avatarUrl })),
    attachments: attachmentRows.map((a) => ({
      id: a.id,
      kind: a.kind,
      url:
        a.kind === "media"
          ? `/api/projects/${projectId}/reports/${reportId}/media/${a.id}`
          : `/api/projects/${projectId}/reports/${reportId}/attachment?id=${a.id}`,
      contentType: a.contentType,
      sizeBytes: a.sizeBytes,
      filename: a.filename ?? null,
      scannedAt: a.scannedAt?.toISOString() ?? null,
      scanStatus: a.scanStatus ?? null,
      scanEngine: a.scanEngine ?? null,
      scanDurationMs: a.scanDurationMs ?? null,
      durationMs: a.durationMs ?? null,
      trimStartMs: a.trimStartMs ?? null,
      trimEndMs: a.trimEndMs ?? null,
    })),
  }
})
