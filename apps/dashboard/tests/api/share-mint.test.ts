import { setup } from "../nuxt-setup"
import { afterEach, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import { eq } from "drizzle-orm"
import { ShareMintResponse } from "@reprojs/shared"
import { db } from "../../server/db"
import { projects, sharedMedia } from "../../server/db/schema"
import { createUser, seedProject, truncateDomain, truncateSharedMedia } from "../helpers"

await setup({ server: true, port: 3000, host: "localhost" })
setDefaultTimeout(15000)

const BASE_URL = process.env.TEST_BASE_URL ?? "http://localhost:3000"
const PK = "rp_pk_SHAREMINT123456789012345"
const ORIGIN = "https://example.com"

async function postMint(opts: {
  origin?: string | null
  projectKey?: string
  mime?: string
  fileType?: string
  includeFile?: boolean
  extraMeta?: Record<string, unknown>
}): Promise<Response> {
  const form = new FormData()
  if (opts.includeFile !== false) {
    form.append(
      "file",
      new File([new Uint8Array(1024).fill(7)], "clip.webm", {
        type: opts.fileType ?? opts.mime ?? "video/webm",
      }),
    )
  }
  form.append(
    "meta",
    new Blob(
      [
        JSON.stringify({
          projectKey: opts.projectKey ?? PK,
          kind: "video",
          mime: opts.mime ?? "video/webm",
          durationMs: 3000,
          trim: { startMs: 0, endMs: 2000 },
          ...opts.extraMeta,
        }),
      ],
      { type: "application/json" },
    ),
  )
  const headers: Record<string, string> = {}
  if (opts.origin !== null) {
    headers.Origin = opts.origin ?? ORIGIN
  }
  return fetch(`${BASE_URL}/api/intake/media`, {
    method: "POST",
    headers,
    body: form,
  })
}

describe("POST /api/intake/media", () => {
  let projectId: string

  beforeAll(async () => {
    await truncateDomain()
    const admin = await createUser("share-mint-admin@example.com", "admin")
    projectId = await seedProject({
      name: "Share Mint Test Project",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: admin,
    })
  })

  afterEach(async () => {
    await truncateSharedMedia()
    // Some tests flip share_links_enabled off — restore for the next test.
    await db.update(projects).set({ shareLinksEnabled: true }).where(eq(projects.id, projectId))
  })

  test("happy path: mints a share link and persists a shared_media row", async () => {
    const res = await postMint({})
    expect(res.status).toBe(201)
    const body = await res.json()
    const parsed = ShareMintResponse.parse(body)
    expect(parsed.token.length).toBeGreaterThanOrEqual(43)
    expect(parsed.shareUrl.endsWith(`/s/${parsed.token}`)).toBe(true)

    const [row] = await db.select().from(sharedMedia).where(eq(sharedMedia.id, parsed.id))
    expect(row).toBeDefined()
    expect(row?.token).toBe(parsed.token)
    expect(row?.trimStartMs).toBe(0)
    expect(row?.trimEndMs).toBe(2000)
    expect(row?.kind).toBe("video")
    expect(row?.mime).toBe("video/webm")

    const now = Date.now()
    const expiresAt = row?.expiresAt ? new Date(row.expiresAt).getTime() : 0
    const expectedExpiry = now + 30 * 24 * 60 * 60 * 1000
    expect(Math.abs(expiresAt - expectedExpiry)).toBeLessThan(5 * 60 * 1000)
  })

  test("share links disabled on the project → 403", async () => {
    await db.update(projects).set({ shareLinksEnabled: false }).where(eq(projects.id, projectId))
    const res = await postMint({})
    expect(res.status).toBe(403)
  })

  test("wrong mime (image/png) → 415", async () => {
    const res = await postMint({ mime: "image/png", fileType: "image/png" })
    expect(res.status).toBe(415)
  })

  test("bad project key → 401", async () => {
    const res = await postMint({ projectKey: "rp_pk_doesnotexist000000000000" })
    expect(res.status).toBe(401)
  })

  test("disallowed Origin → 403", async () => {
    const res = await postMint({ origin: "https://evil.example" })
    expect(res.status).toBe(403)
  })

  test("missing file part → 400", async () => {
    const res = await postMint({ includeFile: false })
    expect(res.status).toBe(400)
  })

  test("invalid trim (endMs < startMs) → 400, no row created", async () => {
    const res = await postMint({ extraMeta: { trim: { startMs: 2000, endMs: 1000 } } })
    expect(res.status).toBe(400)

    // Assert no shared_media row was created for this mint attempt
    const rows = await db.select().from(sharedMedia)
    expect(rows.length).toBe(0)
  })
})
