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
const PK = "rp_pk_SHAREPAGE1234567890123456"

const BUFFER = new Uint8Array(32).map((_, i) => i)

async function seedSharedMedia(
  projectId: string,
  overrides: Partial<typeof sharedMedia.$inferInsert> = {},
): Promise<{ token: string }> {
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
  return { token }
}

describe("GET /s/:token", () => {
  let projectId: string

  beforeAll(async () => {
    await truncateDomain()
    const admin = await createUser("share-page-admin@example.com", "admin")
    projectId = await seedProject({
      name: "Share Page Test Project",
      publicKey: PK,
      allowedOrigins: [],
      createdBy: admin,
    })
  })

  afterEach(async () => {
    await truncateSharedMedia()
  })

  test("live token: 200, renders OG video tags, no sign-in redirect", async () => {
    const { token } = await seedSharedMedia(projectId)
    const res = await fetch(`${BASE_URL}/s/${token}`, {
      headers: { Accept: "text/html" },
      redirect: "manual",
    })
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body).toContain("og:video")
    expect(body).toContain(`/api/shared/${token}/blob`)
    expect(body).not.toContain("/auth/sign-in")
  })

  test("garbage token: 200 SSR page rendering the not-available state", async () => {
    const res = await fetch(`${BASE_URL}/s/not-a-real-token`, {
      headers: { Accept: "text/html" },
      redirect: "manual",
    })
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body).toContain("isn")
    expect(body).toContain("available")
    expect(body).not.toContain("/auth/sign-in")
  })
})
