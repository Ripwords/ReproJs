// Regression tests for half-stored reports (audit 2026-10-26 §4, critical #1).
//
// Before the fix the report row was committed before the replay size check
// and before any attachment was written, so a 413 or a storage failure left
// an orphan report with zero attachments — and the Idempotency-Key
// short-circuit then returned 200 for that orphan forever, so the SDK never
// re-uploaded the attachments.
import { setup } from "../nuxt-setup"
import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import { randomUUID } from "node:crypto"
import { and, eq, sql } from "drizzle-orm"
import { createUser, makePngBlob, seedProject, truncateDomain, truncateReports } from "../helpers"
import { db } from "../../server/db"
import { reportAttachments, reports } from "../../server/db/schema"
import { getStorage } from "../../server/lib/storage"

await setup({ server: true, port: 3000, host: "localhost" })
setDefaultTimeout(30000)

const BASE_URL = process.env.TEST_BASE_URL ?? "http://localhost:3000"
const PK = "rp_pk_ATOMIC1234567890abcdef00"
const ORIGIN = "http://localhost:4000"

function buildReportJSON(title = "atomic"): string {
  return JSON.stringify({
    projectKey: PK,
    title,
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

function buildForm(opts: {
  replayBytes?: number
  screenshot?: boolean
  logs?: boolean
  /** A logs part that fails schema validation (dropped by intake, report kept). */
  invalidLogs?: boolean
}) {
  const fd = new FormData()
  fd.set("report", new Blob([buildReportJSON()], { type: "application/json" }))
  if (opts.screenshot !== false) fd.set("screenshot", makePngBlob(), "s.png")
  if (opts.invalidLogs) {
    fd.set(
      "logs",
      new Blob([JSON.stringify({ version: 1, console: "not-an-array" })], {
        type: "application/json",
      }),
      "logs.json",
    )
  }
  if (opts.logs) {
    fd.set(
      "logs",
      new Blob(
        [
          JSON.stringify({
            version: 1,
            console: [],
            network: [],
            breadcrumbs: [],
            config: {
              consoleMax: 100,
              networkMax: 100,
              breadcrumbsMax: 100,
              capturesBodies: false,
              capturesAllHeaders: false,
            },
          }),
        ],
        { type: "application/json" },
      ),
      "logs.json",
    )
  }
  if (opts.replayBytes !== undefined) {
    fd.set(
      "replay",
      new Blob([new Uint8Array(opts.replayBytes)], { type: "application/gzip" }),
      "replay.json.gz",
    )
  }
  return fd
}

async function post(fd: FormData, idempotencyKey?: string) {
  return fetch(`${BASE_URL}/api/intake/reports`, {
    method: "POST",
    headers: { Origin: ORIGIN, ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}) },
    body: fd,
  })
}

async function seed() {
  const admin = await createUser("admin-atomic@example.com", "admin")
  return seedProject({ name: "Atomic", publicKey: PK, allowedOrigins: [ORIGIN], createdBy: admin })
}

describe("intake atomicity", () => {
  afterEach(async () => {
    await truncateReports()
    await truncateDomain()
  })

  test("oversized replay is rejected with 413 and leaves no report row behind", async () => {
    await seed()
    // INTAKE_REPLAY_MAX_BYTES defaults to 1 MiB; 1 MiB + 1 byte is the SDK's
    // realistic "a few bytes over" case.
    const res = await post(buildForm({ replayBytes: 1_048_577, screenshot: true }), "idem-413")
    expect(res.status).toBe(413)

    const rows = await db.select({ id: reports.id }).from(reports)
    expect(rows.length).toBe(0)

    // A retry with the same Idempotency-Key and a valid replay must now
    // succeed and store every part — the key must not have been burned.
    const retry = await post(buildForm({ replayBytes: 1024, screenshot: true }), "idem-413")
    expect(retry.status).toBe(201)
    const body = (await retry.json()) as { id: string; replayStored?: boolean }
    expect(body.replayStored).toBe(true)
    const atts = await db
      .select({ kind: reportAttachments.kind })
      .from(reportAttachments)
      .where(eq(reportAttachments.reportId, body.id))
    expect(atts.map((a) => a.kind).toSorted()).toEqual(["replay", "screenshot"])
  })

  test("retry with the same Idempotency-Key repairs a half-stored report", async () => {
    const projectId = await seed()
    // Simulate the pre-fix failure mode: a report row that was committed but
    // whose attachments never landed.
    const [orphan] = await db
      .insert(reports)
      .values({
        projectId,
        title: "atomic",
        context: {},
        origin: ORIGIN,
        idempotencyKey: "idem-repair",
      })
      .returning({ id: reports.id })
    if (!orphan) throw new Error("seed failed")

    const res = await post(buildForm({ screenshot: true, logs: true }), "idem-repair")
    expect([200, 201]).toContain(res.status)
    const body = (await res.json()) as { id: string }
    expect(body.id).toBe(orphan.id)

    const atts = await db
      .select({ kind: reportAttachments.kind })
      .from(reportAttachments)
      .where(eq(reportAttachments.reportId, orphan.id))
    expect(atts.map((a) => a.kind).toSorted()).toEqual(["logs", "screenshot"])

    // Still exactly one report for this key.
    const rows = await db
      .select({ id: reports.id })
      .from(reports)
      .where(and(eq(reports.projectId, projectId), eq(reports.idempotencyKey, "idem-repair")))
    expect(rows.length).toBe(1)
  })

  test("a complete report short-circuits to 200 with the same id and no duplicate rows", async () => {
    await seed()
    const first = await post(buildForm({ screenshot: true }), "idem-complete")
    expect(first.status).toBe(201)
    const { id } = (await first.json()) as { id: string }

    const second = await post(buildForm({ screenshot: true }), "idem-complete")
    expect(second.status).toBe(200)
    expect(((await second.json()) as { id: string }).id).toBe(id)

    const atts = await db
      .select({ id: reportAttachments.id })
      .from(reportAttachments)
      .where(eq(reportAttachments.reportId, id))
    expect(atts.length).toBe(1)
    const rows = await db.select({ id: reports.id }).from(reports)
    expect(rows.length).toBe(1)
  })

  test("concurrent submissions with one Idempotency-Key create exactly one report", async () => {
    const projectId = await seed()
    const results = await Promise.all(
      Array.from({ length: 4 }, () => post(buildForm({ screenshot: true }), "idem-race")),
    )
    for (const r of results) expect([200, 201]).toContain(r.status)
    const ids = new Set(
      await Promise.all(results.map(async (r) => ((await r.json()) as { id: string }).id)),
    )
    expect(ids.size).toBe(1)

    const rows = await db
      .select({ id: reports.id })
      .from(reports)
      .where(and(eq(reports.projectId, projectId), eq(reports.idempotencyKey, "idem-race")))
    expect(rows.length).toBe(1)
    const atts = await db
      .select({ id: reportAttachments.id })
      .from(reportAttachments)
      .where(eq(reportAttachments.reportId, rows[0]!.id))
    expect(atts.length).toBe(1)
  })

  test("a retry whose logs part was rejected short-circuits instead of repairing", async () => {
    await seed()
    const first = await post(buildForm({ screenshot: true, invalidLogs: true }), "idem-badlogs")
    expect(first.status).toBe(201)
    const firstBody = (await first.json()) as { id: string; logsStored?: boolean }
    expect(firstBody.logsStored).toBe(false)
    const before = await db
      .select({ id: reportAttachments.id, kind: reportAttachments.kind })
      .from(reportAttachments)
      .where(eq(reportAttachments.reportId, firstBody.id))
    expect(before.map((a) => a.kind)).toEqual(["screenshot"])

    // The report is complete: the rejected logs can never be stored, so the
    // retry must take the 200 short-circuit, not re-upload and re-insert.
    const second = await post(buildForm({ screenshot: true, invalidLogs: true }), "idem-badlogs")
    expect(second.status).toBe(200)
    const secondBody = (await second.json()) as { id: string; logsStored?: boolean }
    expect(secondBody.id).toBe(firstBody.id)
    expect("logsStored" in secondBody).toBe(false)
    const after = await db
      .select({ id: reportAttachments.id })
      .from(reportAttachments)
      .where(eq(reportAttachments.reportId, firstBody.id))
    expect(after.map((a) => a.id)).toEqual(before.map((a) => a.id))
  })

  test("a failed repair keeps the blobs of attachments that were already committed", async () => {
    await seed()
    const first = await post(buildForm({ screenshot: true, logs: true }), "idem-keep")
    expect(first.status).toBe(201)
    const { id } = (await first.json()) as { id: string }
    // Half-stored: the logs row never landed, the screenshot row did.
    await db
      .delete(reportAttachments)
      .where(and(eq(reportAttachments.reportId, id), eq(reportAttachments.kind, "logs")))
    const storage = await getStorage()
    const screenshotKey = `${id}/screenshot.png`
    expect((await storage.get(screenshotKey)).bytes.length).toBeGreaterThan(0)

    // Make the repair transaction fail at the attachment insert for this
    // report only (unique names: the database is shared with other runs).
    const tag = `atomic_fail_${randomUUID().replaceAll("-", "")}`
    await db.execute(
      sql.raw(
        `CREATE FUNCTION ${tag}() RETURNS trigger AS $$ BEGIN ` +
          `IF NEW.report_id = '${id}' THEN RAISE EXCEPTION 'forced repair failure'; END IF; ` +
          `RETURN NEW; END $$ LANGUAGE plpgsql`,
      ),
    )
    await db.execute(
      sql.raw(
        `CREATE TRIGGER ${tag} BEFORE INSERT ON report_attachments FOR EACH ROW EXECUTE FUNCTION ${tag}()`,
      ),
    )
    try {
      const retry = await post(buildForm({ screenshot: true, logs: true }), "idem-keep")
      expect(retry.status).toBe(500)
    } finally {
      await db.execute(sql.raw(`DROP TRIGGER IF EXISTS ${tag} ON report_attachments`))
      await db.execute(sql.raw(`DROP FUNCTION IF EXISTS ${tag}()`))
    }

    // The committed screenshot row survived the failed repair — so must its bytes.
    const rows = await db
      .select({ kind: reportAttachments.kind })
      .from(reportAttachments)
      .where(eq(reportAttachments.reportId, id))
    expect(rows.map((r) => r.kind)).toEqual(["screenshot"])
    expect((await storage.get(screenshotKey)).bytes.length).toBeGreaterThan(0)
  })
})
