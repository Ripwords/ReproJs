// apps/dashboard/tests/api/logs-intake.test.ts
import { setup } from "../nuxt-setup"
import { setDefaultTimeout } from "bun:test"
setDefaultTimeout(30000)
import { afterEach, describe, expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import type { LogsAttachment } from "@reprojs/shared"
import { createUser, makePngBlob, seedProject, truncateDomain, truncateReports } from "../helpers"
import { db } from "../../server/db"
import { reportAttachments, reports } from "../../server/db/schema"

await setup({ server: true, port: 3000, host: "localhost" })

const PK = "rp_pk_ABCDEF1234567890abcdef12"
const ORIGIN = "http://localhost:4000"

function buildReportJSON(projectKey: string, title = "D test") {
  return JSON.stringify({
    projectKey,
    title,
    description: "d",
    context: {
      pageUrl: "http://localhost:4000/p",
      userAgent: "UA",
      viewport: { w: 1000, h: 800 },
      timestamp: new Date().toISOString(),
    },
    // Pass the S2 min-dwell gate.
    _dwellMs: 2000,
  })
}

function buildLogs(): LogsAttachment {
  return {
    version: 1,
    console: [{ level: "log", ts: Date.now(), args: ['"hi"'] }],
    network: [
      {
        id: "a",
        ts: Date.now(),
        method: "GET",
        url: "http://x/",
        status: 200,
        durationMs: 12,
        size: 100,
        initiator: "fetch",
      },
    ],
    breadcrumbs: [{ ts: Date.now(), event: "e", level: "info" }],
    config: {
      consoleMax: 100,
      networkMax: 50,
      breadcrumbsMax: 50,
      capturesBodies: false,
      capturesAllHeaders: false,
    },
  }
}

function buildFormData(opts: { reportJson: string; screenshot?: Blob; logs?: Blob }): FormData {
  const fd = new FormData()
  fd.set("report", new Blob([opts.reportJson], { type: "application/json" }))
  if (opts.screenshot) fd.set("screenshot", opts.screenshot, "screenshot.png")
  if (opts.logs) fd.set("logs", opts.logs, "logs.json")
  return fd
}

describe("logs intake", () => {
  afterEach(async () => {
    await truncateReports()
    await truncateDomain()
  })

  test("happy path: 201, two attachment rows, logs roundtrip", async () => {
    const admin = await createUser("admin@example.com", "admin")
    const projectId = await seedProject({
      name: "Demo",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: admin,
    })
    const logs = buildLogs()
    const res = await fetch("http://localhost:3000/api/intake/reports", {
      method: "POST",
      headers: { Origin: ORIGIN },
      body: buildFormData({
        reportJson: buildReportJSON(PK),
        screenshot: makePngBlob(),
        logs: new Blob([JSON.stringify(logs)], { type: "application/json" }),
      }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { id: string }
    const atts = await db
      .select()
      .from(reportAttachments)
      .where(sql`report_id = ${body.id}`)
    expect(atts.map((a) => a.kind).toSorted()).toEqual(["logs", "screenshot"])
    void projectId
  })

  test("backward compat: no logs part still creates a valid report with just screenshot", async () => {
    const admin = await createUser("admin@example.com", "admin")
    await seedProject({ name: "Demo", publicKey: PK, allowedOrigins: [ORIGIN], createdBy: admin })
    const res = await fetch("http://localhost:3000/api/intake/reports", {
      method: "POST",
      headers: { Origin: ORIGIN },
      body: buildFormData({
        reportJson: buildReportJSON(PK),
        screenshot: makePngBlob(),
      }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { id: string }
    const atts = await db
      .select()
      .from(reportAttachments)
      .where(sql`report_id = ${body.id}`)
    expect(atts.map((a) => a.kind)).toEqual(["screenshot"])
  })

  // Contract change: logs are auto-collected diagnostic decoration, while the
  // report is the user's actual work. Discarding a hand-written bug report
  // because a sidecar blob was malformed is the wrong trade — and it is what
  // silently swallowed every Expo/iOS report in production (a non-string
  // console arg serialized to `null`, failing LogsAttachment). We now keep the
  // report, drop only the logs, and say so via `logsStored: false` — the same
  // success-with-signal shape already used for `replayStored`/`replayDisabled`.
  test("unparseable logs payload still stores the report, minus the logs", async () => {
    const admin = await createUser("admin@example.com", "admin")
    await seedProject({ name: "Demo", publicKey: PK, allowedOrigins: [ORIGIN], createdBy: admin })
    const res = await fetch("http://localhost:3000/api/intake/reports", {
      method: "POST",
      headers: { Origin: ORIGIN },
      body: buildFormData({
        reportJson: buildReportJSON(PK),
        screenshot: makePngBlob(),
        logs: new Blob(["{not json"], { type: "application/json" }),
      }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { id: string; logsStored?: boolean }
    expect(body.logsStored).toBe(false)
    const rows = await db.select().from(reports)
    expect(rows.length).toBe(1)
    const atts = await db
      .select()
      .from(reportAttachments)
      .where(sql`report_id = ${body.id}`)
    // Screenshot survives; no logs row is written.
    expect(atts.map((a) => a.kind)).toEqual(["screenshot"])
  })

  // The exact production shape: valid JSON, but console[].args contains a
  // non-string because the Expo serializer emitted `undefined`.
  test("schema-invalid logs payload still stores the report, minus the logs", async () => {
    const admin = await createUser("admin@example.com", "admin")
    await seedProject({ name: "Demo", publicKey: PK, allowedOrigins: [ORIGIN], createdBy: admin })
    const poisoned = {
      ...buildLogs(),
      console: [{ level: "log", ts: Date.now(), args: [null] }],
    }
    const res = await fetch("http://localhost:3000/api/intake/reports", {
      method: "POST",
      headers: { Origin: ORIGIN },
      body: buildFormData({
        reportJson: buildReportJSON(PK),
        screenshot: makePngBlob(),
        logs: new Blob([JSON.stringify(poisoned)], { type: "application/json" }),
      }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { id: string; logsStored?: boolean }
    expect(body.logsStored).toBe(false)
    expect((await db.select().from(reports)).length).toBe(1)
  })

  test("valid logs report logsStored: true", async () => {
    const admin = await createUser("admin@example.com", "admin")
    await seedProject({ name: "Demo", publicKey: PK, allowedOrigins: [ORIGIN], createdBy: admin })
    const res = await fetch("http://localhost:3000/api/intake/reports", {
      method: "POST",
      headers: { Origin: ORIGIN },
      body: buildFormData({
        reportJson: buildReportJSON(PK),
        screenshot: makePngBlob(),
        logs: new Blob([JSON.stringify(buildLogs())], { type: "application/json" }),
      }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { logsStored?: boolean }
    expect(body.logsStored).toBe(true)
  })

  test("intake hardcodes Content-Type per kind; client-supplied MIME is ignored", async () => {
    const admin = await createUser("admin@example.com", "admin")
    const projectId = await seedProject({
      name: "Demo",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: admin,
    })
    const logs = buildLogs()
    const fd = new FormData()
    fd.set("report", new Blob([buildReportJSON(PK)], { type: "application/json" }))
    fd.set("screenshot", new Blob([makePngBlob()], { type: "text/html" }), "screenshot.png")
    fd.set(
      "logs",
      new Blob([JSON.stringify(logs)], { type: "application/javascript" }),
      "logs.json",
    )
    const res = await fetch("http://localhost:3000/api/intake/reports", {
      method: "POST",
      headers: { Origin: ORIGIN },
      body: fd,
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { id: string }
    const rows = await db
      .select()
      .from(reportAttachments)
      .where(sql`report_id = ${body.id}`)
    const shot = rows.find((a) => a.kind === "screenshot")
    const logsRow = rows.find((a) => a.kind === "logs")
    expect(shot?.contentType).toBe("image/png")
    expect(logsRow?.contentType).toBe("application/json")
    void projectId
  })
})
