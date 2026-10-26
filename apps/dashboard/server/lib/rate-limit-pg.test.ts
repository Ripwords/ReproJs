// Runs against the real Postgres in DATABASE_URL (same as the other lib tests
// that touch the db). Keys are unique per test so runs never collide.
import { afterEach, describe, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import { db } from "../db"
import { rateLimitBuckets } from "../db/schema"
import { createPgRateLimiter } from "./rate-limit-pg"

const used: string[] = []
function key(): string {
  const k = `test:${crypto.randomUUID()}`
  used.push(k)
  return k
}

afterEach(async () => {
  await Promise.all(
    used.splice(0).map((k) => db.delete(rateLimitBuckets).where(eq(rateLimitBuckets.key, k))),
  )
})

describe("createPgRateLimiter", () => {
  test("allows exactly perMinute takes in one window, then refuses", async () => {
    const rl = createPgRateLimiter({ perMinute: 3, now: () => 0 })
    const k = key()
    expect((await rl.take(k)).allowed).toBe(true)
    expect((await rl.take(k)).allowed).toBe(true)
    expect((await rl.take(k)).allowed).toBe(true)
    const fourth = await rl.take(k)
    expect(fourth.allowed).toBe(false)
    expect(fourth.retryAfterMs).toBeGreaterThan(0)
  })

  test("two callers racing the first insert both get a token when two are available", async () => {
    // Both callers miss the SELECT and hit the INSERT at once. The winner
    // leaves one token; the loser must be able to take it. The old conflict
    // path clamped to 0 and then required `tokens >= 1`, refusing the loser
    // even though the bucket held exactly one token.
    const rl = createPgRateLimiter({ perMinute: 2, now: () => 0 })
    const k = key()
    const results = await Promise.all([rl.take(k), rl.take(k)])
    expect(results.filter((r) => r.allowed)).toHaveLength(2)
    expect((await rl.take(k)).allowed).toBe(false)
  })

  test("concurrent takes never over-issue", async () => {
    const rl = createPgRateLimiter({ perMinute: 5, now: () => 0 })
    const k = key()
    const results = await Promise.all(Array.from({ length: 12 }, () => rl.take(k)))
    expect(results.filter((r) => r.allowed)).toHaveLength(5)
  })

  test("refills over time", async () => {
    let t = 0
    const rl = createPgRateLimiter({ perMinute: 2, now: () => t })
    const k = key()
    await rl.take(k)
    await rl.take(k)
    expect((await rl.take(k)).allowed).toBe(false)
    t = 60_001
    expect((await rl.take(k)).allowed).toBe(true)
  })
})
