import type { QueueStorage } from "./storage"
import type { IntakeClient } from "../intake-client"

export interface QueueStatus {
  pending: number
  lastError: string | null
}

export interface DroppedReport {
  id: string
  status: number
  message: string
}

export interface QueueFlusher {
  flush: () => Promise<void>
  /** Cached snapshot, refreshed at the end of every flush. Sync so the
   *  `useRepro()` hook can read it during render. */
  status: () => QueueStatus
  /** Cancels any scheduled retry. Call on provider unmount. */
  stop: () => void
}

/** Retries before a report is given up on. Deliberately well above the
 *  backoff ladder's length so the last delay repeats for a while — a report
 *  should survive a multi-minute server outage, not a single bad minute. */
const DEFAULT_MAX_ATTEMPTS = 10

export function createQueueFlusher(opts: {
  queue: QueueStorage
  client: IntakeClient
  backoffMs: number[]
  maxAttempts?: number
  /** Called when a report is discarded — either a non-retryable client error
   *  or a retryable one that exhausted `maxAttempts`. Without this a failure
   *  deleted the user's report with no trace anywhere, which is exactly how a
   *  400 on the logs part went unnoticed in production. */
  onDrop?: (info: DroppedReport) => void
}): QueueFlusher {
  const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
  const ladder = opts.backoffMs.length > 0 ? opts.backoffMs : [30_000]
  let running = false
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let snapshot: QueueStatus = { pending: 0, lastError: null }

  function clearTimer() {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  /** Schedule the next sweep for the soonest-due pending item. One timer for
   *  the whole queue — per-item timers would stampede the server on wake. */
  function scheduleRetry(attemptsOfPending: number[]) {
    if (stopped || attemptsOfPending.length === 0) return
    const delay = Math.min(
      ...attemptsOfPending.map((a) => ladder[Math.min(a, ladder.length - 1)] ?? ladder.at(-1) ?? 0),
    )
    clearTimer()
    timer = setTimeout(() => {
      timer = null
      void flush()
    }, delay)
    // Never hold the RN event loop open on this timer's account.
    ;(timer as unknown as { unref?: () => void }).unref?.()
  }

  async function flush() {
    if (running || stopped) return
    running = true
    clearTimer()
    let lastError: string | null = null
    const retryableAttempts: number[] = []
    try {
      const items = await opts.queue.all()
      // eslint-disable-next-line no-await-in-loop
      for (const item of items) {
        try {
          // eslint-disable-next-line no-await-in-loop
          await opts.client.submit({
            idempotencyKey: item.id,
            input: item.payload.input,
            attachments: item.payload.attachments.map((a) => ({
              ...a,
              contentType:
                a.contentType ??
                (a.kind === "annotated-screenshot" || a.kind === "screenshot"
                  ? "image/png"
                  : "application/octet-stream"),
            })),
            logs: item.payload.logs,
          })
          // eslint-disable-next-line no-await-in-loop
          await opts.queue.remove(item.id)
        } catch (err) {
          const status = (err as { status?: number }).status ?? 0
          // `fatal` marks a client-side defect no retry can fix (misconfigured
          // intakeUrl, unreadable attachment). It is deliberately separate from
          // "status 0", because a plain network failure while offline also has
          // no status and MUST stay retryable — that is what the queue is for.
          const fatal = (err as { fatal?: boolean }).fatal === true
          const retryable = fatal
            ? false
            : ((err as { retryable?: boolean }).retryable ?? status >= 500)
          const message = (err as Error).message
          const nonRetryableClientError = fatal || (!retryable && status >= 400 && status !== 429)
          const attempts = item.attempts + 1
          const exhausted = attempts >= maxAttempts

          if (nonRetryableClientError || exhausted) {
            // eslint-disable-next-line no-await-in-loop
            await opts.queue.remove(item.id)
            lastError = nonRetryableClientError
              ? `report dropped (HTTP ${status}): ${message}`
              : `report dropped after ${attempts} attempts: ${message}`
            opts.onDrop?.({ id: item.id, status, message })
          } else {
            lastError = message
            retryableAttempts.push(attempts)
            // eslint-disable-next-line no-await-in-loop
            await opts.queue.update(item.id, {
              attempts,
              lastError,
              lastErrorAt: new Date().toISOString(),
            })
          }
        }
      }
    } finally {
      running = false
      // Recount from storage rather than tracking deltas — the queue evicts
      // on enqueue, so a derived counter would drift.
      const remaining = await opts.queue.all().catch(() => null)
      snapshot = {
        pending: remaining?.length ?? snapshot.pending,
        lastError,
      }
      scheduleRetry(retryableAttempts)
    }
  }

  return {
    flush,
    status: () => snapshot,
    stop: () => {
      stopped = true
      clearTimer()
    },
  }
}
