// apps/dashboard/server/lib/triage.ts
import { and, eq, inArray } from "drizzle-orm"
import { createError } from "h3"
import type { TriagePatchInput } from "@reprojs/shared"
import { githubIntegrations, reportAssignees, reportEvents, reports } from "../db/schema"
import type { DB } from "../db"
import { buildReportEvents } from "./report-events"
import { enqueueSync } from "./enqueue-sync"
import { publishReportStream } from "./report-events-bus"

type DbTransaction = Parameters<DB["transaction"]>[0] extends (tx: infer T) => unknown ? T : never

export interface ApplyTicketTriagePatchArgs {
  projectId: string
  reportId: string
  actorId: string
  actorClientId: string | null
  body: TriagePatchInput
}

/**
 * Apply a triage patch (status / priority / tags / assignees / milestone)
 * inside a transaction. Used by:
 *   - The dashboard PATCH endpoint (actorClientId: null)
 *   - MCP repro_update_ticket (actorClientId: OAuth client_id)
 *
 * Throws via h3's createError on:
 *   - 404 if the report doesn't exist or doesn't belong to projectId
 *   - 409 if the body asks to mutate GitHub-mirrored fields (assignees / milestone)
 *     and the report is not linked or the integration is not connected
 *
 * Side effects (all transactional):
 *   - Updates `reports` row
 *   - Inserts `report_assignees` rows (delta) when assignees change
 *   - Inserts `report_events` rows for each change (with actorClientId)
 *   - Enqueues a GitHub sync job when push-on-edit is enabled
 *   - Publishes a SSE event via publishReportStream
 */
export async function applyTicketTriagePatch(tx: DbTransaction, args: ApplyTicketTriagePatchArgs) {
  const [current] = await tx
    .select({
      id: reports.id,
      projectId: reports.projectId,
      status: reports.status,
      priority: reports.priority,
      tags: reports.tags,
      milestoneNumber: reports.milestoneNumber,
      milestoneTitle: reports.milestoneTitle,
      githubIssueNumber: reports.githubIssueNumber,
    })
    .from(reports)
    .where(and(eq(reports.id, args.reportId), eq(reports.projectId, args.projectId)))
    .limit(1)
  if (!current) throw createError({ statusCode: 404, statusMessage: "Report not found" })

  // Integration lookup is used for two separate purposes:
  //   1. Reject GitHub-mirrored mutations (assignees / milestone) when the
  //      report isn't linked or the integration isn't connected — 409.
  //   2. Decide whether any PATCH (even a plain priority/tag/status edit)
  //      should enqueue a push-on-edit sync job.
  // We fetch the integration row once and branch afterwards.
  const wantsGithubMirror = args.body.assignees !== undefined || args.body.milestone !== undefined
  let integration: { pushOnEdit: boolean; status: string } | null = null
  if (wantsGithubMirror || current.githubIssueNumber !== null) {
    const [gi] = await tx
      .select({ pushOnEdit: githubIntegrations.pushOnEdit, status: githubIntegrations.status })
      .from(githubIntegrations)
      .where(eq(githubIntegrations.projectId, args.projectId))
      .limit(1)
    integration = gi ?? null
  }
  if (wantsGithubMirror) {
    if (current.githubIssueNumber === null) {
      throw createError({
        statusCode: 409,
        statusMessage:
          "Report is not linked to a GitHub issue — assignees and milestone are GitHub-only features",
      })
    }
    if (!integration || integration.status !== "connected") {
      throw createError({
        statusCode: 409,
        statusMessage: "Project is not connected to GitHub",
      })
    }
  }

  const patch: Partial<typeof reports.$inferInsert> = {}
  const change: Parameters<typeof buildReportEvents>[3] = {}
  if (args.body.status !== undefined && args.body.status !== current.status) {
    patch.status = args.body.status
    change.status = { from: current.status, to: args.body.status }
  }
  if (args.body.priority !== undefined && args.body.priority !== current.priority) {
    patch.priority = args.body.priority
    change.priority = { from: current.priority, to: args.body.priority }
  }
  if (args.body.tags !== undefined) {
    // Normalize: dedupe + preserve input order for stored value.
    const seen = new Set<string>()
    const nextTags: string[] = []
    for (const t of args.body.tags) {
      if (!seen.has(t)) {
        seen.add(t)
        nextTags.push(t)
      }
    }
    if (nextTags.length !== current.tags.length || nextTags.some((t, i) => t !== current.tags[i])) {
      patch.tags = nextTags
      change.tags = { from: current.tags, to: nextTags }
    }
  }

  // Assignee diff — github logins only. Empty array = clear all assignees.
  const mirrorEvents: (typeof reportEvents.$inferInsert)[] = []
  if (args.body.assignees !== undefined) {
    const currentRows = await tx
      .select({ login: reportAssignees.githubLogin })
      .from(reportAssignees)
      .where(eq(reportAssignees.reportId, args.reportId))
    const currentLogins = currentRows.map((r) => r.login).filter((x): x is string => x !== null)
    const proposed = args.body.assignees
    const toRemove = currentLogins.filter((l) => !proposed.includes(l))
    const toAdd = proposed.filter((l) => !currentLogins.includes(l))

    if (toRemove.length > 0) {
      await tx
        .delete(reportAssignees)
        .where(
          and(
            eq(reportAssignees.reportId, args.reportId),
            inArray(reportAssignees.githubLogin, toRemove),
          ),
        )
    }
    if (toAdd.length > 0) {
      await tx.insert(reportAssignees).values(
        toAdd.map((login) => ({
          reportId: args.reportId,
          githubLogin: login,
          assignedBy: args.actorId,
        })),
      )
    }

    for (const login of toRemove) {
      mirrorEvents.push({
        reportId: args.reportId,
        projectId: args.projectId,
        actorId: args.actorId,
        actorClientId: args.actorClientId,
        kind: "assignee_removed",
        payload: { githubLogin: login },
      })
    }
    for (const login of toAdd) {
      mirrorEvents.push({
        reportId: args.reportId,
        projectId: args.projectId,
        actorId: args.actorId,
        actorClientId: args.actorClientId,
        kind: "assignee_added",
        payload: { githubLogin: login },
      })
    }
  }

  if ("milestone" in args.body && args.body.milestone !== undefined) {
    const prev = {
      number: current.milestoneNumber,
      title: current.milestoneTitle,
    }
    const next = args.body.milestone
    const changed =
      (prev.number === null) !== (next === null) ||
      (prev.number !== null &&
        next !== null &&
        (prev.number !== next.number || prev.title !== next.title))
    if (changed) {
      patch.milestoneNumber = next?.number ?? null
      patch.milestoneTitle = next?.title ?? null
      mirrorEvents.push({
        reportId: args.reportId,
        projectId: args.projectId,
        actorId: args.actorId,
        actorClientId: args.actorClientId,
        kind: "milestone_changed",
        payload: { from: prev, to: next },
      })
    }
  }

  const hasReportPatch = Object.keys(patch).length > 0
  const hasEvents = Object.keys(change).length > 0 || mirrorEvents.length > 0

  if (!hasReportPatch && mirrorEvents.length === 0) {
    // No-op — don't bump updated_at or emit events.
    return { ok: true, updated: false }
  }

  if (hasReportPatch) {
    patch.updatedAt = new Date()
    await tx
      .update(reports)
      .set(patch)
      .where(and(eq(reports.id, args.reportId), eq(reports.projectId, args.projectId)))
  } else if (mirrorEvents.length > 0) {
    // Bump updatedAt even when only assignees/milestone changed
    await tx
      .update(reports)
      .set({ updatedAt: new Date() })
      .where(and(eq(reports.id, args.reportId), eq(reports.projectId, args.projectId)))
  }

  const reportChangeEvents = buildReportEvents(args.reportId, args.projectId, args.actorId, change)
  const allEvents = [
    ...reportChangeEvents.map((e) => ({ ...e, actorClientId: args.actorClientId })),
    ...mirrorEvents,
  ]
  if (allEvents.length > 0) await tx.insert(reportEvents).values(allEvents)

  // Enqueue a GitHub sync job when we have something to push AND the
  // integration is connected with push-on-edit enabled. Deferred until
  // AFTER the transaction commits so a later rollback doesn't leave a
  // phantom sync job (and a spurious triage SSE notification for changes
  // that never landed) behind.
  const shouldEnqueueGithubSync =
    hasEvents &&
    current.githubIssueNumber !== null &&
    integration?.status === "connected" &&
    integration.pushOnEdit === true

  return { ok: true, updated: true, hasEvents, shouldEnqueueGithubSync }
}

/**
 * Post-commit side effects for applyTicketTriagePatch. Call this after the
 * transaction that called applyTicketTriagePatch has committed.
 */
export async function applyTicketTriagePatchSideEffects(
  reportId: string,
  projectId: string,
  result: { updated: boolean; hasEvents?: boolean; shouldEnqueueGithubSync?: boolean },
) {
  if (result.updated && result.hasEvents) {
    if (result.shouldEnqueueGithubSync) {
      await enqueueSync(reportId, projectId)
    }
    publishReportStream(reportId, { kind: "triage" })
  }
}
