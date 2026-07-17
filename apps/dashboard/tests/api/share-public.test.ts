import { randomBytes } from "node:crypto"
import { setup } from "../nuxt-setup"
import { afterEach, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import { db } from "../../server/db"
import { sharedMedia } from "../../server/db/schema"
import { getStorage } from "../../server/lib/storage"
import { createUser, seedProject, truncateDomain, truncateSharedMedia } from "../helpers"

await setup({ server: true, port: 3000, host: "localhost" })
setDefaultTimeout(15000)

const BASE_URL = process.env.TEST_BASE_URL ?? "http://localhost:3000"
const PK = "rp_pk_SHAREPUBLIC1234567890123"

// Known 32-byte buffer: byte i has value i, so slicing is trivially verifiable.
const BUFFER = new Uint8Array(32).map((_, i) => i)

async function seedSharedMedia(
  projectId: string,
  overrides: Partial<typeof sharedMedia.$inferInsert> = {},
): Promise<{ token: string; storageKey: string }> {
  const storage = await getStorage()
  const token = randomBytes(32).toString("base64url")
  const id = crypto.randomUUID()
  const storageKey = `shared-media/${id}.webm`
  await storage.put(storageKey, BUFFER, "video/webm")
  await db.insert(sharedMedia).values({
    id,
    projectId,
    token,
    kind: "video",
    mime: "video/webm",
    storageKey,
    sizeBytes: BUFFER.length,
    durationMs: 3000,
    trimStartMs: 0,
    trimEndMs: 2000,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    ...overrides,
  })
  return { token, storageKey }
}

describe("GET /api/shared/:token and /api/shared/:token/blob", () => {
  let projectId: string

  beforeAll(async () => {
    await truncateDomain()
    const admin = await createUser("share-public-admin@example.com", "admin")
    projectId = await seedProject({
      name: "Share Public Test Project",
      publicKey: PK,
      allowedOrigins: [],
      createdBy: admin,
    })
  })

  afterEach(async () => {
    await truncateSharedMedia()
  })

  test("meta: 200 with the expected shape and no project info", async () => {
    const { token } = await seedSharedMedia(projectId)
    const res = await fetch(`${BASE_URL}/api/shared/${token}`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({
      kind: "video",
      mime: "video/webm",
      sizeBytes: 32,
      durationMs: 3000,
      trimStartMs: 0,
      trimEndMs: 2000,
      createdAt: expect.any(String),
      expiresAt: expect.any(String),
    })
    expect(body.projectId).toBeUndefined()
    expect(body.storageKey).toBeUndefined()
    expect(body.id).toBeUndefined()
    expect(body.token).toBeUndefined()
  })

  test("blob: no Range header → 200 full body + accept-ranges", async () => {
    const { token } = await seedSharedMedia(projectId)
    const res = await fetch(`${BASE_URL}/api/shared/${token}/blob`)
    expect(res.status).toBe(200)
    expect(res.headers.get("accept-ranges")).toBe("bytes")
    expect(res.headers.get("content-type")).toBe("video/webm")
    expect(res.headers.get("x-content-type-options")).toBe("nosniff")
    const buf = new Uint8Array(await res.arrayBuffer())
    expect(buf.length).toBe(32)
    expect([...buf]).toEqual([...BUFFER])
  })

  test("blob: Range: bytes=8-15 → 206 with exact slice", async () => {
    const { token } = await seedSharedMedia(projectId)
    const res = await fetch(`${BASE_URL}/api/shared/${token}/blob`, {
      headers: { Range: "bytes=8-15" },
    })
    expect(res.status).toBe(206)
    expect(res.headers.get("content-range")).toBe("bytes 8-15/32")
    expect(res.headers.get("content-length")).toBe("8")
    const buf = new Uint8Array(await res.arrayBuffer())
    expect([...buf]).toEqual(Array.from(BUFFER.slice(8, 16)))
  })

  test("blob: unsatisfiable Range → 416 with bytes */total", async () => {
    const { token } = await seedSharedMedia(projectId)
    const res = await fetch(`${BASE_URL}/api/shared/${token}/blob`, {
      headers: { Range: "bytes=99-" },
    })
    expect(res.status).toBe(416)
    expect(res.headers.get("content-range")).toBe("bytes */32")
  })

  test("expired row → 404 on both meta and blob", async () => {
    const { token } = await seedSharedMedia(projectId, {
      expiresAt: new Date(Date.now() - 60_000),
    })
    const metaRes = await fetch(`${BASE_URL}/api/shared/${token}`)
    expect(metaRes.status).toBe(404)
    const blobRes = await fetch(`${BASE_URL}/api/shared/${token}/blob`)
    expect(blobRes.status).toBe(404)
  })

  test("revoked row → 404 on both meta and blob", async () => {
    const { token } = await seedSharedMedia(projectId, { revokedAt: new Date() })
    const metaRes = await fetch(`${BASE_URL}/api/shared/${token}`)
    expect(metaRes.status).toBe(404)
    const blobRes = await fetch(`${BASE_URL}/api/shared/${token}/blob`)
    expect(blobRes.status).toBe(404)
  })

  test("garbage token → 404 on both meta and blob", async () => {
    const metaRes = await fetch(`${BASE_URL}/api/shared/not-a-real-token`)
    expect(metaRes.status).toBe(404)
    const blobRes = await fetch(`${BASE_URL}/api/shared/not-a-real-token/blob`)
    expect(blobRes.status).toBe(404)
  })
})
