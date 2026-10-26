import { setup } from "../nuxt-setup"
import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import type { ReportDetailDTO, ReportSummaryDTO } from "@reprojs/shared"
import { db } from "../../server/db"
import { reportAttachments, reports } from "../../server/db/schema"
import {
  apiFetch,
  createUser,
  makePngBlob,
  seedProject,
  signIn,
  truncateDomain,
  truncateReports,
} from "../helpers"

await setup({ server: true, port: 3000, host: "localhost" })

const BASE_URL = process.env.TEST_BASE_URL ?? "http://localhost:3000"

setDefaultTimeout(60000)

const PK = "rp_pk_ABCDEF1234567890abcdef12"
const ORIGIN = "http://localhost:4000"

async function submitReport(title: string) {
  const fd = new FormData()
  fd.set(
    "report",
    new Blob(
      [
        JSON.stringify({
          projectKey: PK,
          title,
          description: "d",
          context: {
            pageUrl: "http://localhost:4000/p",
            userAgent: "UA",
            viewport: { w: 1000, h: 800 },
            timestamp: new Date().toISOString(),
            reporter: { email: "u@example.com" },
          },
          _dwellMs: 2000,
        }),
      ],
      { type: "application/json" },
    ),
  )
  fd.set("screenshot", makePngBlob(), "s.png")
  const res = await fetch(`${BASE_URL}/api/intake/reports`, {
    method: "POST",
    headers: { Origin: ORIGIN },
    body: fd,
  })
  if (res.status !== 201) throw new Error(`intake failed: ${res.status}`)
  return ((await res.json()) as { id: string }).id
}

describe("reports list API", () => {
  afterEach(async () => {
    await truncateReports()
    await truncateDomain()
  })

  test("admin sees reports for a project ordered newest first", async () => {
    const admin = await createUser("admin@example.com", "admin")
    const projectId = await seedProject({
      name: "Demo",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: admin,
    })
    await submitReport("first")
    await new Promise((r) => setTimeout(r, 10))
    await submitReport("second")

    const cookie = await signIn("admin@example.com")
    const { status, body } = await apiFetch<{ items: ReportSummaryDTO[]; total: number }>(
      `/api/projects/${projectId}/reports`,
      { headers: { cookie } },
    )
    expect(status).toBe(200)
    expect(body.total).toBe(2)
    expect(body.items[0].title).toBe("second")
    expect(body.items[1].title).toBe("first")
    expect(body.items[0].reporterEmail).toBe("u@example.com")
    expect(body.items[0].thumbnailUrl).toContain("/attachment")
  })

  test("non-member gets 404", async () => {
    const admin = await createUser("admin@example.com", "admin")
    await createUser("stranger@example.com", "member")
    const projectId = await seedProject({
      name: "Demo",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: admin,
    })
    await submitReport("private")

    const cookie = await signIn("stranger@example.com")
    const { status } = await apiFetch(`/api/projects/${projectId}/reports`, { headers: { cookie } })
    expect(status).toBe(404)
  })
})

describe("source filter and facets", () => {
  afterEach(async () => {
    await truncateReports()
    await truncateDomain()
  })

  test("list endpoint filters by ?source=expo", async () => {
    const admin = await createUser("admin@example.com", "admin")
    const projectId = await seedProject({
      name: "Demo",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: admin,
    })
    await db.insert(reports).values({
      projectId,
      title: "Web report",
      context: {
        source: "web",
        pageUrl: "http://localhost:4000/p",
        userAgent: "UA",
        viewport: { w: 1000, h: 800 },
        timestamp: new Date().toISOString(),
      },
      origin: ORIGIN,
      ip: "127.0.0.1",
      source: "web",
    })
    await db.insert(reports).values({
      projectId,
      title: "Expo iOS crash",
      context: {
        source: "expo",
        pageUrl: "myapp://x",
        userAgent: "u",
        viewport: { w: 1, h: 1 },
        timestamp: new Date().toISOString(),
      },
      origin: "",
      ip: "127.0.0.1",
      source: "expo",
      devicePlatform: "ios",
    })

    const cookie = await signIn("admin@example.com")
    const { status, body } = await apiFetch<{ items: ReportSummaryDTO[]; total: number }>(
      `/api/projects/${projectId}/reports?source=expo`,
      { headers: { cookie } },
    )
    expect(status).toBe(200)
    expect(body.total).toBe(1)
    expect(body.items.every((i) => i.source === "expo")).toBe(true)
  })

  test("list endpoint returns source facets with counts", async () => {
    const admin = await createUser("admin@example.com", "admin")
    const projectId = await seedProject({
      name: "Demo",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: admin,
    })
    await db.insert(reports).values({
      projectId,
      title: "Web report",
      context: {
        source: "web",
        pageUrl: "http://localhost:4000/p",
        userAgent: "UA",
        viewport: { w: 1000, h: 800 },
        timestamp: new Date().toISOString(),
      },
      origin: ORIGIN,
      ip: "127.0.0.1",
      source: "web",
    })
    await db.insert(reports).values([
      {
        projectId,
        title: "Expo iOS crash",
        context: {
          source: "expo",
          pageUrl: "myapp://x",
          userAgent: "u",
          viewport: { w: 1, h: 1 },
          timestamp: new Date().toISOString(),
        },
        origin: "",
        ip: "127.0.0.1",
        source: "expo",
        devicePlatform: "ios",
      },
      {
        projectId,
        title: "Expo Android crash",
        context: {
          source: "expo",
          pageUrl: "myapp://y",
          userAgent: "u",
          viewport: { w: 1, h: 1 },
          timestamp: new Date().toISOString(),
        },
        origin: "",
        ip: "127.0.0.1",
        source: "expo",
        devicePlatform: "android",
      },
    ])

    const cookie = await signIn("admin@example.com")
    const { status, body } = await apiFetch<{
      items: ReportSummaryDTO[]
      total: number
      facets: { source: { web: number; expo: number; ios: number; android: number } }
    }>(`/api/projects/${projectId}/reports`, { headers: { cookie } })
    expect(status).toBe(200)
    expect(body.facets.source.web).toBe(1)
    expect(body.facets.source.expo).toBe(2)
    expect(body.facets.source.ios).toBe(1)
    expect(body.facets.source.android).toBe(1)
  })

  test("list endpoint filters by ?source=ios", async () => {
    const admin = await createUser("admin@example.com", "admin")
    const projectId = await seedProject({
      name: "Demo",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: admin,
    })
    await db.insert(reports).values([
      {
        projectId,
        title: "Web report",
        context: {
          source: "web",
          pageUrl: "http://localhost:4000/p",
          userAgent: "UA",
          viewport: { w: 1000, h: 800 },
          timestamp: new Date().toISOString(),
        },
        origin: ORIGIN,
        ip: "127.0.0.1",
        source: "web",
      },
      {
        projectId,
        title: "Expo iOS crash",
        context: {
          source: "expo",
          pageUrl: "myapp://x",
          userAgent: "u",
          viewport: { w: 1, h: 1 },
          timestamp: new Date().toISOString(),
        },
        origin: "",
        ip: "127.0.0.1",
        source: "expo",
        devicePlatform: "ios",
      },
      {
        projectId,
        title: "Expo Android crash",
        context: {
          source: "expo",
          pageUrl: "myapp://y",
          userAgent: "u",
          viewport: { w: 1, h: 1 },
          timestamp: new Date().toISOString(),
        },
        origin: "",
        ip: "127.0.0.1",
        source: "expo",
        devicePlatform: "android",
      },
    ])

    const cookie = await signIn("admin@example.com")
    const { status, body } = await apiFetch<{ items: ReportSummaryDTO[]; total: number }>(
      `/api/projects/${projectId}/reports?source=ios`,
      { headers: { cookie } },
    )
    expect(status).toBe(200)
    expect(body.total).toBe(1)
    expect(body.items.every((i) => i.source === "expo" && i.devicePlatform === "ios")).toBe(true)
  })
})

describe("report detail endpoint", () => {
  afterEach(async () => {
    await truncateReports()
    await truncateDomain()
  })

  test("GET /reports/:id includes user-file attachments with filename", async () => {
    const admin = await createUser("admin@example.com", "admin")
    const projectId = await seedProject({
      name: "Demo",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: admin,
    })

    // Insert a report row directly (no screenshot needed — we just want the detail shape)
    const [report] = await db
      .insert(reports)
      .values({
        projectId,
        title: "User file report",
        context: {
          source: "web",
          pageUrl: "http://localhost:4000/p",
          userAgent: "UA",
          viewport: { w: 1000, h: 800 },
          timestamp: new Date().toISOString(),
        },
        origin: ORIGIN,
        ip: "127.0.0.1",
        source: "web",
      })
      .returning()

    if (!report) throw new Error("report insert failed")

    // Insert a user-file attachment directly (no storage backend needed for metadata test)
    await db.insert(reportAttachments).values({
      reportId: report.id,
      kind: "user-file",
      storageKey: "projects/test/reports/test/user/screenshot.png",
      contentType: "image/png",
      sizeBytes: 4096,
      filename: "screenshot.png",
    })

    const cookie = await signIn("admin@example.com")
    const { status, body } = await apiFetch<ReportDetailDTO>(
      `/api/projects/${projectId}/reports/${report.id}`,
      { headers: { cookie } },
    )

    expect(status).toBe(200)
    expect(body.attachments).toBeDefined()
    expect(body.attachments).toHaveLength(1)
    const att = body.attachments[0]
    if (!att) throw new Error("attachment missing")
    expect(att.kind).toBe("user-file")
    expect(att.filename).toBe("screenshot.png")
    expect(att.contentType).toBe("image/png")
    expect(att.sizeBytes).toBe(4096)
    expect(att.url).toContain(`/api/projects/${projectId}/reports/${report.id}/attachment?id=`)
  })
})

describe("attachment GET", () => {
  afterEach(async () => {
    await truncateReports()
    await truncateDomain()
  })

  test("streams PNG bytes with correct Content-Type", async () => {
    const admin = await createUser("admin@example.com", "admin")
    const projectId = await seedProject({
      name: "Demo",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: admin,
    })
    const reportId = await submitReport("pic")

    const cookie = await signIn("admin@example.com")
    const res = await fetch(
      `${BASE_URL}/api/projects/${projectId}/reports/${reportId}/attachment?kind=screenshot`,
      { headers: { cookie } },
    )
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toBe("image/png")
    const buf = new Uint8Array(await res.arrayBuffer())
    // PNG signature
    expect(Array.from(buf.slice(0, 4))).toEqual([137, 80, 78, 71])
  })

  test("cross-project attachment access returns 404", async () => {
    const admin = await createUser("admin@example.com", "admin")
    await seedProject({
      name: "A",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: admin,
    })
    const projectB = await seedProject({
      name: "B",
      publicKey: "rp_pk_BBBBBBBBBBBBBBBBBBBBBBBB",
      allowedOrigins: [ORIGIN],
      createdBy: admin,
    })
    const reportId = await submitReport("in A")

    const cookie = await signIn("admin@example.com")
    const res = await fetch(
      `${BASE_URL}/api/projects/${projectB}/reports/${reportId}/attachment?kind=screenshot`,
      { headers: { cookie } },
    )
    expect(res.status).toBe(404)
  })
})
