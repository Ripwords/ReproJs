// apps/dashboard/tests/api/report-media-stream.test.ts
import { setup } from "../nuxt-setup"
import { afterEach, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import { eq } from "drizzle-orm"
import { db } from "../../server/db"
import { projectMembers, reportAttachments } from "../../server/db/schema"
import { createUser, seedProject, signIn, truncateDomain, truncateReports } from "../helpers"

await setup({ server: true, port: 3000, host: "localhost" })
setDefaultTimeout(15000)

const BASE_URL = process.env.TEST_BASE_URL ?? "http://localhost:3000"
const PK = "rp_pk_MEDIASTREAM123456789012a"
const ORIGIN = "https://example.com"

function reportBlob(): Blob {
  return new Blob(
    [
      JSON.stringify({
        projectKey: PK,
        title: "with media",
        description: "x",
        context: {
          source: "web",
          url: "https://example.com/page",
          pageUrl: "https://example.com/page",
          userAgent: "Mozilla/5.0 Test",
          viewport: { w: 1440, h: 900 },
          timestamp: new Date().toISOString(),
        },
        _dwellMs: 5000,
        _hp: "",
      }),
    ],
    { type: "application/json" },
  )
}

// Same happy-path FormData shape as tests/api/intake-media.test.ts — the
// real intake route is the simplest way to get a genuine kind="media" row
// (with trim metadata) + real storage bytes.
async function postReportWithMedia(): Promise<string> {
  const form = new FormData()
  form.append("report", reportBlob())
  form.append(
    "media[0]",
    new File([new Uint8Array([10, 11, 12, 13, 14, 15, 16, 17])], "media-0.webm", {
      type: "video/webm",
    }),
  )
  form.append(
    "mediaMeta",
    new Blob(
      [
        JSON.stringify([
          {
            kind: "video",
            mime: "video/webm",
            durationMs: 5000,
            trim: { startMs: 1000, endMs: 4000 },
          },
        ]),
      ],
      { type: "application/json" },
    ),
  )
  const res = await fetch(`${BASE_URL}/api/intake/reports`, {
    method: "POST",
    headers: { Origin: ORIGIN },
    body: form,
  })
  if (res.status !== 201) {
    throw new Error(`seed intake failed: ${res.status} ${await res.text()}`)
  }
  const body = (await res.json()) as { id: string }
  return body.id
}

async function seedMember(
  email: string,
  projectId: string,
  role: "viewer" | "manager" | "developer" | "owner",
): Promise<{ userId: string; cookie: string }> {
  const userId = await createUser(email, "member")
  await db.insert(projectMembers).values({ projectId, userId, role })
  const cookie = await signIn(email)
  return { userId, cookie }
}

describe("GET /api/projects/:id/reports/:reportId/media/:attachmentId", () => {
  let projectId: string

  beforeAll(async () => {
    await truncateDomain()
    const admin = await createUser("media-stream-admin@example.com", "admin")
    projectId = await seedProject({
      name: "Media Stream Test Project",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: admin,
    })
  })

  afterEach(async () => {
    await truncateReports()
  })

  test("no Range header -> 200 with full bytes", async () => {
    const reportId = await postReportWithMedia()
    const [row] = await db
      .select()
      .from(reportAttachments)
      .where(eq(reportAttachments.reportId, reportId))
    if (!row) throw new Error("expected media attachment row")

    const { cookie } = await seedMember("viewer-full@example.com", projectId, "viewer")
    const res = await fetch(
      `${BASE_URL}/api/projects/${projectId}/reports/${reportId}/media/${row.id}`,
      { headers: { cookie } },
    )
    expect(res.status).toBe(200)
    const buf = new Uint8Array(await res.arrayBuffer())
    expect(Array.from(buf)).toEqual([10, 11, 12, 13, 14, 15, 16, 17])
    expect(res.headers.get("content-type")).toBe("video/webm")
    expect(res.headers.get("content-disposition")).toStartWith("inline")
    expect(res.headers.get("cache-control")).toBe("private, max-age=3600")
  })

  test("Range: bytes=0-3 -> 206 with content-range", async () => {
    const reportId = await postReportWithMedia()
    const [row] = await db
      .select()
      .from(reportAttachments)
      .where(eq(reportAttachments.reportId, reportId))
    if (!row) throw new Error("expected media attachment row")

    const { cookie } = await seedMember("viewer-range@example.com", projectId, "viewer")
    const res = await fetch(
      `${BASE_URL}/api/projects/${projectId}/reports/${reportId}/media/${row.id}`,
      { headers: { cookie, Range: "bytes=0-3" } },
    )
    expect(res.status).toBe(206)
    expect(res.headers.get("content-range")).toBe("bytes 0-3/8")
    const buf = new Uint8Array(await res.arrayBuffer())
    expect(Array.from(buf)).toEqual([10, 11, 12, 13])
  })

  test("a user-file attachment id on the media route -> 404", async () => {
    const reportId = await postReportWithMedia()
    const [userFileRow] = await db
      .insert(reportAttachments)
      .values({
        reportId,
        kind: "user-file",
        storageKey: "reports/whatever/user-file.txt",
        contentType: "text/plain",
        sizeBytes: 3,
        filename: "notes.txt",
      })
      .returning()
    if (!userFileRow) throw new Error("failed to seed user-file row")

    const { cookie } = await seedMember("viewer-wrongkind@example.com", projectId, "viewer")
    const res = await fetch(
      `${BASE_URL}/api/projects/${projectId}/reports/${reportId}/media/${userFileRow.id}`,
      { headers: { cookie } },
    )
    expect(res.status).toBe(404)
  })

  test("signed-out request -> non-200", async () => {
    const reportId = await postReportWithMedia()
    const [row] = await db
      .select()
      .from(reportAttachments)
      .where(eq(reportAttachments.reportId, reportId))
    if (!row) throw new Error("expected media attachment row")

    const res = await fetch(
      `${BASE_URL}/api/projects/${projectId}/reports/${reportId}/media/${row.id}`,
    )
    expect(res.status).not.toBe(200)
  })

  test("detail endpoint returns durationMs/trimStartMs/trimEndMs and media url for the media attachment", async () => {
    const reportId = await postReportWithMedia()
    const [row] = await db
      .select()
      .from(reportAttachments)
      .where(eq(reportAttachments.reportId, reportId))
    if (!row) throw new Error("expected media attachment row")

    const { cookie } = await seedMember("viewer-detail@example.com", projectId, "viewer")
    const res = await fetch(`${BASE_URL}/api/projects/${projectId}/reports/${reportId}`, {
      headers: { cookie },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      attachments: {
        id: string
        kind: string
        url: string
        durationMs: number | null
        trimStartMs: number | null
        trimEndMs: number | null
      }[]
    }
    const mediaDto = body.attachments.find((a) => a.id === row.id)
    expect(mediaDto).toBeDefined()
    expect(mediaDto?.kind).toBe("media")
    expect(mediaDto?.url).toBe(`/api/projects/${projectId}/reports/${reportId}/media/${row.id}`)
    expect(mediaDto?.durationMs).toBe(5000)
    expect(mediaDto?.trimStartMs).toBe(1000)
    expect(mediaDto?.trimEndMs).toBe(4000)
  })
})
