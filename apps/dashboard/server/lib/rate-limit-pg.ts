import { eq, sql } from "drizzle-orm"
import { db } from "../db"
import { rateLimitBuckets } from "../db/schema"
import type { RateLimiterOptions, TakeResult } from "./rate-limit"

/**
 * Postgres-backed token-bucket rate limiter. Identical semantics to the
 * in-process version — same perMinute cap, same fractional refill — but
 * survives restarts and works across workers / processes.
 *
 * Cost: one small transaction per take() call. Acceptable for intake which is
 * already DB-bound; do NOT use on hot paths that don't otherwise touch the DB.
 */

const WINDOW_MS = 60_000
const SWEEP_PROBABILITY = 0.01
const SWEEP_AGE_MS = 10 * WINDOW_MS

export function createPgRateLimiter(opts: RateLimiterOptions) {
  const { perMinute } = opts
  const now = opts.now ?? (() => Date.now())

  return {
    async take(key: string): Promise<TakeResult> {
      const t = now()

      const result = await db.transaction(async (tx) => {
        const rows = await tx
          .select()
          .from(rateLimitBuckets)
          .where(eq(rateLimitBuckets.key, key))
          .for("update")
        const existing = rows[0]

        let bucket = existing
        if (!bucket) {
          // First take for this key: insert perMinute-1 (we just consumed one).
          // Two concurrent txs can both miss the SELECT; DO NOTHING lets the
          // loser fall through to the normal existing-row path below instead
          // of doing its own ad-hoc decrement. The old `DO UPDATE SET tokens
          // = GREATEST(tokens-1, 0)` + `tokens >= 1` check was off by one:
          // a bucket holding exactly one token was refused.
          const inserted = await tx.execute<{ tokens: number; last_refill_ms: string | number }>(
            sql`
              INSERT INTO rate_limit_buckets (key, tokens, last_refill_ms)
              VALUES (${key}, ${perMinute - 1}, ${t})
              ON CONFLICT (key) DO NOTHING
              RETURNING tokens, last_refill_ms
            `,
          )
          if (inserted.rows.length > 0) return { allowed: true, retryAfterMs: 0 }
          // Lost the race: the row now exists and is committed (DO NOTHING
          // only returns once the conflicting writer finished), so lock it.
          const relocked = await tx
            .select()
            .from(rateLimitBuckets)
            .where(eq(rateLimitBuckets.key, key))
            .for("update")
          bucket = relocked[0]
          if (!bucket) {
            // Row vanished between the conflict and our re-read (sweep). Deny
            // conservatively rather than over-issue.
            return { allowed: false, retryAfterMs: Math.ceil(WINDOW_MS / perMinute) }
          }
        }

        const elapsed = Math.max(0, t - bucket.lastRefillMs)
        const refilled = Math.min(perMinute, bucket.tokens + (elapsed / WINDOW_MS) * perMinute)

        if (refilled >= 1) {
          await tx
            .update(rateLimitBuckets)
            .set({ tokens: refilled - 1, lastRefillMs: t })
            .where(eq(rateLimitBuckets.key, key))
          return { allowed: true, retryAfterMs: 0 }
        }

        await tx
          .update(rateLimitBuckets)
          .set({ tokens: refilled, lastRefillMs: t })
          .where(eq(rateLimitBuckets.key, key))
        const needed = 1 - refilled
        const retryAfterMs = Math.max(1, Math.ceil((needed / perMinute) * WINDOW_MS))
        return { allowed: false, retryAfterMs }
      })

      if (Math.random() < SWEEP_PROBABILITY) {
        await db
          .execute(sql`DELETE FROM rate_limit_buckets WHERE last_refill_ms < ${t - SWEEP_AGE_MS}`)
          .catch(() => {
            /* best-effort */
          })
      }

      return result
    },
  }
}
