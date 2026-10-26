// apps/dashboard/server/lib/github-sync-runner.ts
//
// Core runner for `report_sync_jobs`. Shared between the Nitro scheduled
// task (`server/tasks/github/sync.ts`) and the in-process trigger fired
// directly by enqueue helpers after a write.
//
// Why a shared module: for the user-facing hot path (triage PATCH, comment
// post, auto-create on intake) a cron floor of N seconds is a noticeable
// delay before the change reflects on GitHub. Running the same processor
// in-process, fire-and-forget, gives sub-second reflection on the happy
// path while the cron remains as the durable retry + crash recovery.
//
// Concurrency safety: both callers race against each other on any row, so
// we claim with a conditional UPDATE (WHERE state='pending') + RETURNING.
// Exactly one caller wins the state='syncing' transition; the other sees
// zero rows back and skips. No SKIP LOCKED needed — we only process one
// row at a time per (report_id, signature) and the transition itself is
// the lock.

import { and, eq, lt, lte, sql } from "drizzle-orm"
import { db } from "../db"
import { reportSyncJobs } from "../db/schema"
import {
  ReconcileSkipped,
  reconcileReport,
  reconcileCommentUpsertJob,
  reconcileCommentDeleteJob,
} from "./github-reconcile"
import { computeBackoff } from "./github-helpers"

type SyncJob = typeof reportSyncJobs.$inferSelect

// Stale-syncing recovery: if a worker claims a row (state='syncing') but
// crashes before completing, the row would otherwise stay 'syncing'
// forever. Sweep anything older than this threshold back to 'pending'.
// Generous vs. a normal sync (seconds) so we don't false-positive a
// slow-but-alive worker.
export const STALE_SYNCING_MS = 10 * 60_000
export const MAX_ATTEMPTS = 5

/**
 * Atomic claim: transition the row from 'pending' → 'syncing' only if
 * nothing else has already claimed it. Returns the full row on win, null
 * if someone else already has it (or it no longer exists).
 */
async function claimJob(reportId: string, signature: string): Promise<SyncJob | null> {
  const claimed = await db
    .update(reportSyncJobs)
    .set({ state: "syncing", updatedAt: new Date() })
    .where(
      and(
        eq(reportSyncJobs.reportId, reportId),
        eq(reportSyncJobs.signature, signature),
        eq(reportSyncJobs.state, "pending"),
      ),
    )
    .returning()
  return claimed[0] ?? null
}

/**
 * Process a single already-claimed job. Must be called ONLY after `claimJob`
 * returned the row — this function doesn't re-check state.
 */
async function processClaimedJob(job: SyncJob): Promise<void> {
  const jobKey = and(
    eq(reportSyncJobs.reportId, job.reportId),
    eq(reportSyncJobs.signature, job.signature),
  )
  try {
    const payload = job.payload
    if (payload?.kind === "comment_upsert") {
      await reconcileCommentUpsertJob(job.reportId, payload.commentId)
    } else if (payload?.kind === "comment_delete") {
      await reconcileCommentDeleteJob(job.reportId, payload.commentId, payload.githubCommentId)
    } else {
      // null / { kind: "reconcile" } → standard whole-report reconcile
      await reconcileReport(job.reportId)
    }
    // Only remove the row if nothing asked for a rerun while we were
    // syncing. Otherwise a dashboard write that landed mid-flight would be
    // silently dropped with the row.
    const deleted = await db
      .delete(reportSyncJobs)
      .where(and(jobKey, eq(reportSyncJobs.rerunRequested, false)))
      .returning({ reportId: reportSyncJobs.reportId })
    if (deleted.length === 0) {
      await db
        .update(reportSyncJobs)
        .set({
          state: "pending",
          rerunRequested: false,
          attempts: 0,
          lastError: null,
          nextAttemptAt: new Date(),
          updatedAt: new Date(),
        })
        .where(jobKey)
      triggerReportSync(job.reportId)
    }
  } catch (err) {
    if (err instanceof ReconcileSkipped) {
      // reconcileReport has already deleted the job row (and siblings) —
      // nothing left to update.
      return
    }
    const attempts = job.attempts + 1
    const backoffMs = computeBackoff(attempts)
    const state = attempts >= MAX_ATTEMPTS ? "failed" : "pending"
    await db
      .update(reportSyncJobs)
      .set({
        state,
        // The retry re-reads the report from scratch, which covers any
        // write that asked for a rerun during this failed pass.
        rerunRequested: false,
        attempts,
        lastError: err instanceof Error ? err.message.slice(0, 500) : String(err).slice(0, 500),
        nextAttemptAt: new Date(Date.now() + backoffMs),
        updatedAt: new Date(),
      })
      .where(jobKey)
  }
}

/**
 * Claim + process one specific job (identified by the composite key).
 * No-op if the row has already been claimed by another worker.
 */
export async function runSyncJob(reportId: string, signature: string): Promise<void> {
  const job = await claimJob(reportId, signature)
  if (!job) return
  await processClaimedJob(job)
}

/**
 * Fire-and-forget entry point for enqueue helpers. Pulls every pending row
 * for a given report, processes them concurrently, and absorbs all errors
 * — anything that throws here is already persisted on the row as
 * `last_error` and will be retried by the cron. Callers should NOT await
 * this; it exists to shorten happy-path latency, not to gate the response.
 */
export function triggerReportSync(reportId: string): void {
  // Defer to the next microtask so the caller's transaction has a chance to
  // commit before we read. Without this, a same-tick read can miss the
  // freshly-inserted row under some driver/pool configurations.
  queueMicrotask(() => {
    void (async () => {
      try {
        const pendingRows = await db
          .select({
            reportId: reportSyncJobs.reportId,
            signature: reportSyncJobs.signature,
          })
          .from(reportSyncJobs)
          .where(
            and(
              eq(reportSyncJobs.reportId, reportId),
              eq(reportSyncJobs.state, "pending"),
              lte(reportSyncJobs.nextAttemptAt, new Date()),
            ),
          )
        if (pendingRows.length === 0) return
        await Promise.all(pendingRows.map((r) => runSyncJob(r.reportId, r.signature)))
      } catch (err) {
        // Swallow — the cron is still there as the safety net and the row
        // is already persisted.
        console.error(`[github-sync] in-process trigger failed for ${reportId}:`, err)
      }
    })()
  })
}

/**
 * Reset stuck-syncing rows back to pending (or failed if they exhausted
 * retries). Only the cron calls this — the in-process trigger won't.
 */
export async function recoverStuckJobs(): Promise<void> {
  const staleThreshold = new Date(Date.now() - STALE_SYNCING_MS)
  await db
    .update(reportSyncJobs)
    .set({
      state: sql`CASE WHEN ${reportSyncJobs.attempts} + 1 >= ${MAX_ATTEMPTS} THEN 'failed' ELSE 'pending' END`,
      rerunRequested: false,
      attempts: sql`${reportSyncJobs.attempts} + 1`,
      lastError: "worker crashed while syncing (recovered by stale-job sweep)",
      updatedAt: new Date(),
    })
    .where(and(eq(reportSyncJobs.state, "syncing"), lt(reportSyncJobs.updatedAt, staleThreshold)))
}

/**
 * Drain the queue: keep claiming batches of `batch` runnable rows and
 * processing each batch in parallel until nothing is left or `max` jobs
 * have run this tick. Called by the cron on each tick. A single batch per
 * tick meant a backlog after a restart drained at 10 jobs/minute.
 */
export async function drainPendingJobs(
  opts: { batch?: number; max?: number } = {},
): Promise<{ processed: number }> {
  const batchSize = opts.batch ?? 10
  const max = opts.max ?? 500
  let processed = 0
  while (processed < max) {
    // eslint-disable-next-line no-await-in-loop -- each batch must finish before the next claim so a failed job (now pending with backoff) isn't re-selected
    const batch = await db
      .select({
        reportId: reportSyncJobs.reportId,
        signature: reportSyncJobs.signature,
      })
      .from(reportSyncJobs)
      .where(
        and(eq(reportSyncJobs.state, "pending"), lte(reportSyncJobs.nextAttemptAt, new Date())),
      )
      .orderBy(reportSyncJobs.nextAttemptAt)
      .limit(Math.min(batchSize, max - processed))
    if (batch.length === 0) break
    // eslint-disable-next-line no-await-in-loop -- see above
    await Promise.all(batch.map((r) => runSyncJob(r.reportId, r.signature)))
    processed += batch.length
  }
  return { processed }
}

// Re-exported for tests that want to exercise only the process side
// (bypassing the claim race).
export { processClaimedJob as _processClaimedJobForTesting, claimJob as _claimJobForTesting }
