// apps/dashboard/server/lib/github-link.ts
import { and, eq } from "drizzle-orm"
import { createError } from "h3"
import type { DB } from "../db"
import { githubIntegrations, reportEvents, reports, reportSyncJobs } from "../db/schema"
import { enqueueSync } from "./enqueue-sync"

type DbTransaction = Parameters<DB["transaction"]>[0] extends (tx: infer T) => unknown ? T : never

export interface LinkArgs {
  projectId: string
  reportId: string
  actorId: string
  actorClientId: string | null
}

export interface LinkToIssueArgs extends LinkArgs {
  repoOwner: string
  repoName: string
  issueNumber: number
}

/**
 * Link a Repro report to an existing GitHub issue. Sets reports.githubIssueNumber/Url
 * and inserts a report_events row of kind "github_linked". Caller should follow up
 * with linkReportToGithubIssueSideEffects() to enqueue the sync job that pulls
 * the issue's labels/assignees/state from GitHub on the next reconciler tick.
 *
 * Throws via h3 createError on:
 *   - 404 if report doesn't exist or doesn't match projectId
 *   - 409 if no connected GitHub integration on the project
 *   - 409 if the report is already linked to a DIFFERENT issue (caller must unlink first)
 *
 * Returns { issueNumber, issueUrl, alreadyLinked } where alreadyLinked is true when
 * this link is a no-op because the report was already linked to the same issue.
 */
export async function linkReportToGithubIssue(
  tx: DbTransaction,
  args: LinkToIssueArgs,
): Promise<{ issueNumber: number; issueUrl: string; alreadyLinked: boolean }> {
  const [current] = await tx
    .select({
      id: reports.id,
      githubIssueNumber: reports.githubIssueNumber,
    })
    .from(reports)
    .where(and(eq(reports.id, args.reportId), eq(reports.projectId, args.projectId)))
    .limit(1)
  if (!current) throw createError({ statusCode: 404, statusMessage: "report not found" })

  const [integration] = await tx
    .select({ status: githubIntegrations.status })
    .from(githubIntegrations)
    .where(eq(githubIntegrations.projectId, args.projectId))
    .limit(1)
  if (!integration || integration.status !== "connected") {
    throw createError({ statusCode: 409, statusMessage: "Project is not connected to GitHub" })
  }

  if (current.githubIssueNumber !== null && current.githubIssueNumber !== args.issueNumber) {
    throw createError({
      statusCode: 409,
      statusMessage: `Report already linked to issue #${current.githubIssueNumber}; unlink first`,
    })
  }

  const issueUrl = `https://github.com/${args.repoOwner}/${args.repoName}/issues/${args.issueNumber}`
  const alreadyLinked = current.githubIssueNumber === args.issueNumber

  if (!alreadyLinked) {
    await tx
      .update(reports)
      .set({
        githubIssueNumber: args.issueNumber,
        githubIssueUrl: issueUrl,
        updatedAt: new Date(),
      })
      .where(eq(reports.id, args.reportId))

    await tx.insert(reportEvents).values({
      reportId: args.reportId,
      projectId: args.projectId,
      actorId: args.actorId,
      actorClientId: args.actorClientId,
      kind: "github_linked",
      payload: {
        repoOwner: args.repoOwner,
        repoName: args.repoName,
        number: args.issueNumber,
        url: issueUrl,
      },
    })
  }

  return { issueNumber: args.issueNumber, issueUrl, alreadyLinked }
}

export interface LinkSideEffectArgs {
  reportId: string
  projectId: string
}

/**
 * Run the side effects that must happen AFTER the transaction that called
 * linkReportToGithubIssue commits. Enqueues a reconcile sync job so the
 * worker pulls the issue's current state (labels, assignees, state) from
 * GitHub on the next tick. Errors (e.g. issue not found, no permission) are
 * surfaced via the existing sync-job error pipeline.
 */
export async function linkReportToGithubIssueSideEffects(args: LinkSideEffectArgs): Promise<void> {
  await enqueueSync(args.reportId, args.projectId)
}

/**
 * Unlink a report from its GitHub issue. Idempotent — returns
 * { ok: true, unlinked: false } if nothing was linked.
 *
 * Side effects (all in-tx): clears githubIssueNumber/NodeId/Url columns on
 * reports, deletes pending report_sync_jobs rows, inserts a "github_unlinked"
 * report_event.
 *
 * No post-commit side effects — the unlink does NOT push back to GitHub.
 */
export async function unlinkReportFromGithubIssue(
  tx: DbTransaction,
  args: LinkArgs,
): Promise<{ ok: true; unlinked: boolean }> {
  const [current] = await tx
    .select()
    .from(reports)
    .where(and(eq(reports.id, args.reportId), eq(reports.projectId, args.projectId)))
    .limit(1)
  if (!current) throw createError({ statusCode: 404, statusMessage: "report not found" })
  if (current.githubIssueNumber == null) {
    return { ok: true, unlinked: false }
  }

  await tx
    .update(reports)
    .set({
      githubIssueNumber: null,
      githubIssueNodeId: null,
      githubIssueUrl: null,
      updatedAt: new Date(),
    })
    .where(eq(reports.id, args.reportId))

  await tx.delete(reportSyncJobs).where(eq(reportSyncJobs.reportId, args.reportId))

  await tx.insert(reportEvents).values({
    reportId: args.reportId,
    projectId: args.projectId,
    actorId: args.actorId,
    actorClientId: args.actorClientId,
    kind: "github_unlinked",
    payload: {
      number: current.githubIssueNumber,
      url: current.githubIssueUrl,
    },
  })

  return { ok: true, unlinked: true }
}
