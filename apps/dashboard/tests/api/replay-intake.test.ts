import { setup } from "../nuxt-setup"
import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import { sql } from "drizzle-orm"
import { createUser, makePngBlob, seedProject, truncateDomain, truncateReports } from "../helpers"
import { db } from "../../server/db"
import { projects, reportAttachments } from "../../server/db/schema"

await setup({ server: true, port: 3000, host: "localhost" })

const BASE_URL = process.env.TEST_BASE_URL ?? "http://localhost:3000"
setDefaultTimeout(15000)

const PK = "rp_pk_ABCDEF1234567890abcdef12"
const ORIGIN = "http://localhost:4000"

async function gzipOf(input: string): Promise<Uint8Array> {
  const cs = new CompressionStream("gzip")
  const stream = new Blob([new TextEncoder().encode(input)]).stream().pipeThrough(cs)
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

function buildReportJSON(): string {
  return JSON.stringify({
    projectKey: PK,
    title: "E test",
    description: "d",
    context: {
      pageUrl: "http://localhost:4000/p",
      userAgent: "UA",
      viewport: { w: 1000, h: 800 },
      timestamp: new Date().toISOString(),
    },
    _dwellMs: 2000,
  })
}

describe("replay intake", () => {
  afterEach(async () => {
    await truncateReports()
    await truncateDomain()
  })

  test("happy path: replay part persists as attachment with kind='replay'", async () => {
    const admin = await createUser("admin@example.com", "admin")
    await seedProject({ name: "Demo", publicKey: PK, allowedOrigins: [ORIGIN], createdBy: admin })
    const replay = await gzipOf(
      JSON.stringify([{ type: 4, data: { href: "x", width: 1, height: 1 }, timestamp: 1 }]),
    )
    const fd = new FormData()
    fd.set("report", new Blob([buildReportJSON()], { type: "application/json" }))
    fd.set("screenshot", makePngBlob(), "s.png")
    fd.set("replay", new Blob([replay], { type: "application/gzip" }), "replay.json.gz")
    const res = await fetch(`${BASE_URL}/api/intake/reports`, {
      method: "POST",
      headers: { Origin: ORIGIN },
      body: fd,
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as {
      id: string
      replayStored?: boolean
      replayDisabled?: boolean
    }
    expect(body.replayStored).toBe(true)
    expect(body.replayDisabled).toBeFalsy()
    const atts = await db
      .select()
      .from(reportAttachments)
      .where(sql`report_id = ${body.id}`)
    const replayRow = atts.find((a) => a.kind === "replay")
    expect(replayRow).toBeDefined()
    expect(replayRow?.contentType).toBe("application/gzip")
  })

  test("missing replay part: report still created (backward compat)", async () => {
    const admin = await createUser("admin@example.com", "admin")
    await seedProject({ name: "Demo", publicKey: PK, allowedOrigins: [ORIGIN], createdBy: admin })
    const fd = new FormData()
    fd.set("report", new Blob([buildReportJSON()], { type: "application/json" }))
    fd.set("screenshot", makePngBlob(), "s.png")
    const res = await fetch(`${BASE_URL}/api/intake/reports`, {
      method: "POST",
      headers: { Origin: ORIGIN },
      body: fd,
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { id: string; replayStored?: boolean }
    expect(body.replayStored).toBeFalsy()
  })

  test("project.replayEnabled=false: replay silently dropped, 201 with signal", async () => {
    const admin = await createUser("admin@example.com", "admin")
    const projectId = await seedProject({
      name: "Demo",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: admin,
    })
    await db
      .update(projects)
      .set({ replayEnabled: false })
      .where(sql`id = ${projectId}`)
    const replay = await gzipOf("[]")
    const fd = new FormData()
    fd.set("report", new Blob([buildReportJSON()], { type: "application/json" }))
    fd.set("screenshot", makePngBlob(), "s.png")
    fd.set("replay", new Blob([replay], { type: "application/gzip" }), "replay.json.gz")
    const res = await fetch(`${BASE_URL}/api/intake/reports`, {
      method: "POST",
      headers: { Origin: ORIGIN },
      body: fd,
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as {
      id: string
      replayStored?: boolean
      replayDisabled?: boolean
    }
    expect(body.replayStored).toBe(false)
    expect(body.replayDisabled).toBe(true)
    const atts = await db
      .select()
      .from(reportAttachments)
      .where(sql`report_id = ${body.id}`)
    expect(atts.find((a) => a.kind === "replay")).toBeUndefined()
  })
})
