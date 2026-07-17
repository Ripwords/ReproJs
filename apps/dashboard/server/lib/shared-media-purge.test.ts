// apps/dashboard/server/lib/shared-media-purge.test.ts
// Integration test — hits the real Postgres instance and the real (local-
// disk) storage adapter, mirroring server/lib/github-write-locks.test.ts.
// Run with: bun test apps/dashboard/server/lib/shared-media-purge.test.ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import { db } from "../db"
import { projects, sharedMedia } from "../db/schema"
import { getStorage } from "./storage"
import { purgeSharedMedia } from "./shared-media-purge"

let testProjectId: string

async function truncate() {
  await db.execute(sql`TRUNCATE shared_media RESTART IDENTITY CASCADE`)
}

beforeEach(async () => {
  await db.execute(
    sql`TRUNCATE project_invitations, project_members, projects, "account", "session", "verification", "user" RESTART IDENTITY CASCADE`,
  )
  await truncate()

  const [p] = await db
    .insert(projects)
    .values({
      name: "test",
      createdBy: "user-test",
      publicKey: "rp_pk_sharedmediapurgetest",
      allowedOrigins: [],
    })
    .returning()
  testProjectId = p.id
})

afterEach(async () => {
  await truncate()
  await db.execute(
    sql`TRUNCATE project_invitations, project_members, projects, "account", "session", "verification", "user" RESTART IDENTITY CASCADE`,
  )
})

async function seedRow(opts: {
  label: string
  expiresAt: Date
  revokedAt?: Date | null
}): Promise<{ id: string; storageKey: string }> {
  const storage = await getStorage()
  const storageKey = `shared-media/purge-test-${opts.label}-${Math.random().toString(36).slice(2)}.webm`
  await storage.put(storageKey, new Uint8Array([1, 2, 3, 4]), "video/webm")

  const [row] = await db
    .insert(sharedMedia)
    .values({
      projectId: testProjectId,
      token: `tok_${opts.label}_${Math.random().toString(36).slice(2)}`,
      kind: "video",
      mime: "video/webm",
      storageKey,
      sizeBytes: 4,
      expiresAt: opts.expiresAt,
      revokedAt: opts.revokedAt ?? null,
    })
    .returning({ id: sharedMedia.id })
  if (!row) throw new Error("seedRow: insert returned no row")
  return { id: row.id, storageKey }
}

describe("purgeSharedMedia", () => {
  test("deletes expired and long-revoked rows + blobs; leaves live and recently-revoked ones", async () => {
    const now = new Date("2026-07-17T12:00:00.000Z")

    const live = await seedRow({
      label: "live",
      expiresAt: new Date(now.getTime() + 60 * 60 * 1000), // +1h, not expired
    })
    const expired = await seedRow({
      label: "expired",
      expiresAt: new Date(now.getTime() - 60 * 1000), // -1min, expired
    })
    const revoked25hAgo = await seedRow({
      label: "revoked-25h",
      expiresAt: new Date(now.getTime() + 60 * 60 * 1000), // not expired on its own
      revokedAt: new Date(now.getTime() - 25 * 60 * 60 * 1000), // revoked 25h ago
    })
    const revoked1hAgo = await seedRow({
      label: "revoked-1h",
      expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
      revokedAt: new Date(now.getTime() - 60 * 60 * 1000), // revoked 1h ago — inside grace
    })

    const result = await purgeSharedMedia(now)
    expect(result).toEqual({ purged: 2 })

    const remaining = await db.select().from(sharedMedia)
    const remainingIds = remaining.map((r) => r.id).toSorted()
    expect(remainingIds).toEqual([live.id, revoked1hAgo.id].toSorted())

    const storage = await getStorage()

    // Live + recently-revoked rows remain, and their blobs are untouched.
    await expect(storage.get(live.storageKey)).resolves.toBeDefined()
    await expect(storage.get(revoked1hAgo.storageKey)).resolves.toBeDefined()

    // Purged rows' blobs are gone.
    await expect(storage.get(expired.storageKey)).rejects.toBeDefined()
    await expect(storage.get(revoked25hAgo.storageKey)).rejects.toBeDefined()
  })

  test("storage.delete failure (missing blob) does not block row deletion", async () => {
    const now = new Date("2026-07-17T12:00:00.000Z")
    const expired = await seedRow({
      label: "missing-blob",
      expiresAt: new Date(now.getTime() - 1000),
    })

    // Simulate a blob that's already gone from storage.
    const storage = await getStorage()
    await storage.delete(expired.storageKey)

    const result = await purgeSharedMedia(now)
    expect(result).toEqual({ purged: 1 })

    const remaining = await db.select().from(sharedMedia)
    expect(remaining.length).toBe(0)
  })

  test("returns { purged: 0 } when nothing qualifies", async () => {
    const now = new Date("2026-07-17T12:00:00.000Z")
    await seedRow({ label: "live-only", expiresAt: new Date(now.getTime() + 60 * 60 * 1000) })

    const result = await purgeSharedMedia(now)
    expect(result).toEqual({ purged: 0 })
  })
})
