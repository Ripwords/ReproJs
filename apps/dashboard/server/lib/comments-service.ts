// apps/dashboard/server/lib/comments-service.ts
import { eq } from "drizzle-orm"
import { createError } from "h3"
import type { DB } from "../db"
import { db } from "../db"
import { reportComments } from "../db/schema/report-comments"
import { reports } from "../db/schema/reports"
import { githubIntegrations } from "../db/schema/github-integrations"
import { reportEvents } from "../db/schema/report-events"
import { enqueueCommentUpsert } from "./enqueue-sync"
import { publishReportStream } from "./report-events-bus"

// Mirror the DbTransaction type pattern from triage.ts
type DbTransaction = Parameters<DB["transaction"]>[0] extends (tx: infer T) => unknown ? T : never

export interface AddReportCommentArgs {
  projectId: string
  reportId: string
  actorId: string
  actorClientId: string | null
  body: string
}

export interface AddReportCommentResult {
  comment: typeof reportComments.$inferSelect
  /** Forwarded to addReportCommentSideEffects to avoid a second DB lookup. */
  githubIssueNumber: number | null
}

/**
 * Insert a dashboard-source comment on a report. Used by:
 *   - The dashboard POST endpoint (actorClientId: null)
 *   - MCP repro_add_comment (actorClientId: OAuth client_id)
 *
 * In-tx: validates the report belongs to the project, inserts the
 * report_comments row (source: "dashboard", actorClientId), inserts a
 * report_events row of kind "comment_added" (with actorClientId).
 *
 * Throws 404 if the report doesn't exist or doesn't match projectId.
 */
export async function addReportComment(
  tx: DbTransaction,
  args: AddReportCommentArgs,
): Promise<AddReportCommentResult> {
  const [report] = await tx.select().from(reports).where(eq(reports.id, args.reportId)).limit(1)
  if (!report || report.projectId !== args.projectId) {
    throw createError({ statusCode: 404, statusMessage: "Report not found" })
  }

  const [inserted] = await tx
    .insert(reportComments)
    .values({
      reportId: args.reportId,
      userId: args.actorId,
      actorClientId: args.actorClientId,
      body: args.body,
      source: "dashboard",
    })
    .returning()

  await tx.insert(reportEvents).values({
    reportId: args.reportId,
    projectId: args.projectId,
    actorId: args.actorId,
    actorClientId: args.actorClientId,
    kind: "comment_added",
    payload: { commentId: inserted.id },
  })

  return {
    comment: inserted,
    githubIssueNumber: report.githubIssueNumber,
  }
}

export interface AddReportCommentSideEffectArgs {
  projectId: string
  reportId: string
  commentId: string
  githubIssueNumber: number | null
}

/**
 * Run the side effects that must happen AFTER the transaction commits:
 *   - enqueueCommentUpsert (push the comment to GitHub if integration is connected)
 *   - publishReportStream (SSE event for dashboard live-updates)
 */
export async function addReportCommentSideEffects(
  args: AddReportCommentSideEffectArgs,
): Promise<void> {
  if (args.githubIssueNumber !== null) {
    const [integration] = await db
      .select({ status: githubIntegrations.status })
      .from(githubIntegrations)
      .where(eq(githubIntegrations.projectId, args.projectId))
      .limit(1)

    if (integration?.status === "connected") {
      await enqueueCommentUpsert(args.reportId, args.commentId)
    }
  }

  publishReportStream(args.reportId, {
    kind: "comment_added",
    payload: { commentId: args.commentId },
  })
}
