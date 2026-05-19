import { z } from "zod"
import { ReportEventKind, ReportPriority, ReportStatus } from "./reports"

// Minimal per-row shape for /admin's recent-reports list. Purpose-built
// (NOT an extension of ReportSummaryDTO) because the admin row only
// renders title + priority + project + timestamp — there's no need to
// ship context/pageUrl/tags/assignee for a 10-row glance list.
export const AdminRecentReportDTO = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  projectName: z.string(),
  title: z.string(),
  status: ReportStatus,
  priority: ReportPriority,
  receivedAt: z.string(),
})
export type AdminRecentReportDTO = z.infer<typeof AdminRecentReportDTO>

// Mirrors ProjectOverviewDTO.recentEvents but carries project context per row.
// Kind enum matches the per-project overview exactly.
export const AdminRecentEventDTO = z.object({
  id: z.uuid(),
  reportId: z.uuid(),
  reportTitle: z.string(),
  projectId: z.uuid(),
  projectName: z.string(),
  kind: ReportEventKind,
  payload: z.record(z.string(), z.unknown()),
  actor: z
    .object({
      id: z.string(),
      email: z.email(),
      name: z.string().nullable(),
    })
    .nullable(),
  createdAt: z.string(),
})
export type AdminRecentEventDTO = z.infer<typeof AdminRecentEventDTO>

export const AdminProjectBreakdownDTO = z.object({
  id: z.uuid(),
  name: z.string(),
  openCount: z.number().int(),
  newLast7Count: z.number().int(),
  totalCount: z.number().int(),
})
export type AdminProjectBreakdownDTO = z.infer<typeof AdminProjectBreakdownDTO>

export const AdminOverviewDTO = z.object({
  counts: z.object({
    total: z.number().int(),
    byStatus: z.record(ReportStatus, z.number().int()),
    byPriority: z.record(ReportPriority, z.number().int()),
    last7Days: z.number().int(),
  }),
  projects: z.object({
    total: z.number().int(),
    withGithub: z.number().int(),
  }),
  recentReports: z.array(AdminRecentReportDTO),
  recentEvents: z.array(AdminRecentEventDTO),
  perProject: z.array(AdminProjectBreakdownDTO),
  // Zero-filled daily report counts for the trend chart. Ordered oldest →
  // newest; every UTC day in the trailing window is present (gaps = 0).
  // `date` is a `YYYY-MM-DD` UTC day string.
  volume: z.array(
    z.object({
      date: z.string(),
      count: z.number().int(),
    }),
  ),
})
export type AdminOverviewDTO = z.infer<typeof AdminOverviewDTO>
