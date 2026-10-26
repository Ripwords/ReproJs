import { setup } from "../nuxt-setup"
import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import { sql } from "drizzle-orm"
import { createUser, makePngBlob, seedProject, truncateDomain, truncateReports } from "../helpers"
import { db } from "../../server/db"
import { projects, reports, reportAttachments } from "../../server/db/schema"

// INTAKE_RATE_PER_KEY_ANON is read by the dashboard process, not this test
// process. The tiered rate-limit test below is env-independent — it bursts
// enough requests to trigger any reasonable default cap.

await setup({ server: true, port: 3000, host: "localhost" })
setDefaultTimeout(15000)

const BASE_URL = process.env.TEST_BASE_URL ?? "http://localhost:3000"
const PK = "rp_pk_ABCDEF1234567890abcdef12"
const BAD_PK = "rp_pk_ZZZZZZZZZZZZZZZZZZZZZZZZ"
const ORIGIN = "http://localhost:4000"

function buildReportJSON(
  projectKey: string,
  extra: Partial<{
    title: string
    _dwellMs: number
    _hp: string
    reporterUserId: string | null
  }> = {},
) {
  const reporter =
    extra.reporterUserId === null
      ? undefined
      : extra.reporterUserId
        ? { userId: extra.reporterUserId, email: "user@example.com" }
        : { email: "user@example.com" }
  return JSON.stringify({
    projectKey,
    title: extra.title ?? "It broke",
    description: "Clicking the Save button did nothing.",
    context: {
      pageUrl: "http://localhost:4000/app",
      userAgent: "Mozilla/5.0 Test",
      viewport: { w: 1440, h: 900 },
      timestamp: new Date().toISOString(),
      ...(reporter ? { reporter } : {}),
    },
    // Default dwell to 2s so tests pass the S2 min-dwell gate. Tests that
    // specifically exercise the gate override with a low value (e.g. 300).
    _dwellMs: extra._dwellMs ?? 2000,
    ...(extra._hp !== undefined ? { _hp: extra._hp } : {}),
  })
}

function buildMultipart(reportJson: string, screenshot?: Blob): FormData {
  const fd = new FormData()
  fd.set("report", new Blob([reportJson], { type: "application/json" }))
  if (screenshot) fd.set("screenshot", screenshot, "screenshot.png")
  return fd
}

describe("intake API", () => {
  afterEach(async () => {
    await truncateReports()
    await truncateDomain()
  })

  test("happy path: 201, creates report + attachment", async () => {
    const admin = await createUser("admin@example.com", "admin")
    await seedProject({
      name: "Demo",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: admin,
    })

    const res = await fetch(`${BASE_URL}/api/intake/reports`, {
      method: "POST",
      headers: { Origin: ORIGIN },
      body: buildMultipart(buildReportJSON(PK), makePngBlob()),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { id: string }
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN)

    const [row] = await db
      .select()
      .from(reports)
      .where(sql`id = ${body.id}`)
    expect(row.title).toBe("It broke")
    const atts = await db
      .select()
      .from(reportAttachments)
      .where(sql`report_id = ${body.id}`)
    expect(atts.length).toBe(1)
    expect(atts[0].kind).toBe("screenshot")
  })

  test("rejects wrong origin with 403 and withholds ACAO (no cross-origin oracle)", async () => {
    const admin = await createUser("admin@example.com", "admin")
    await seedProject({
      name: "Demo",
      publicKey: PK,
      allowedOrigins: ["http://prod.example.com"],
      createdBy: admin,
    })

    const res = await fetch(`${BASE_URL}/api/intake/reports`, {
      method: "POST",
      headers: { Origin: "http://evil.example.com" },
      body: buildMultipart(buildReportJSON(PK), makePngBlob()),
    })
    expect(res.status).toBe(403)
    // ACAO deliberately NOT emitted before origin validation — this blocks
    // cross-origin scripts from reading the 401/403 error body and using it
    // as an enumeration oracle for valid project keys.
    expect(res.headers.get("access-control-allow-origin")).toBeNull()
  })

  test("rejects bad project key with 401", async () => {
    const res = await fetch(`${BASE_URL}/api/intake/reports`, {
      method: "POST",
      headers: { Origin: ORIGIN },
      body: buildMultipart(buildReportJSON(BAD_PK), makePngBlob()),
    })
    expect(res.status).toBe(401)
  })

  test("OPTIONS preflight returns 204 with ACAO reflecting origin", async () => {
    const res = await fetch(`${BASE_URL}/api/intake/reports`, {
      method: "OPTIONS",
      headers: {
        Origin: ORIGIN,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "Content-Type",
      },
    })
    expect(res.status).toBe(204)
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN)
    expect(res.headers.get("access-control-allow-methods")).toContain("POST")
  })

  test("rejects submissions with dwell < 1500ms", async () => {
    const admin = await createUser("admin@example.com", "admin")
    await seedProject({
      name: "Demo",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: admin,
    })
    const res = await fetch(`${BASE_URL}/api/intake/reports`, {
      method: "POST",
      headers: { Origin: ORIGIN },
      body: buildMultipart(buildReportJSON(PK, { _dwellMs: 300 }), makePngBlob()),
    })
    expect(res.status).toBe(400)
  })

  test("honeypot: non-empty _hp returns fake 201 and does not persist", async () => {
    const admin = await createUser("admin@example.com", "admin")
    const projectId = await seedProject({
      name: "Demo",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: admin,
    })
    const res = await fetch(`${BASE_URL}/api/intake/reports`, {
      method: "POST",
      headers: { Origin: ORIGIN },
      body: buildMultipart(buildReportJSON(PK, { _hp: "i-am-a-bot" }), makePngBlob()),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { id: string }
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/)
    const rows = await db
      .select()
      .from(reports)
      .where(sql`project_id = ${projectId}`)
    expect(rows.length).toBe(0)
  })

  test("daily ceiling: rejects when cap already met", async () => {
    const admin = await createUser("admin@example.com", "admin")
    const projectId = await seedProject({
      name: "Demo",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: admin,
    })
    await db
      .update(projects)
      .set({ dailyReportCap: 1 })
      .where(sql`id = ${projectId}`)

    const r1 = await fetch(`${BASE_URL}/api/intake/reports`, {
      method: "POST",
      headers: { Origin: ORIGIN },
      body: buildMultipart(buildReportJSON(PK), makePngBlob()),
    })
    expect(r1.status).toBe(201)

    const r2 = await fetch(`${BASE_URL}/api/intake/reports`, {
      method: "POST",
      headers: { Origin: ORIGIN },
      body: buildMultipart(buildReportJSON(PK), makePngBlob()),
    })
    expect(r2.status).toBe(429)
    expect(r2.headers.get("retry-after")).toBe("3600")
  })

  // Skipped: bursting enough anon requests to trigger the anon rate bucket
  // also drains the per-IP bucket (both keyed on 127.0.0.1 in local runs),
  // which cascades 429s into the next test files. The tiered-limiter logic is
  // unit-tested in apps/dashboard/server/lib/rate-limit.test.ts, which covers
  // the same semantics without the cross-test IP pollution.
  test.skip("tiered rate limit: anonymous stricter than authenticated", async () => {
    const admin = await createUser("admin@example.com", "admin")
    await seedProject({
      name: "Demo",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: admin,
    })

    // Env-independent check: dashboard may have been started with any value
    // for INTAKE_RATE_PER_KEY_ANON (default 10). Fire enough anon submissions
    // to exhaust any reasonable default, then assert at least one 429 appears.
    const BURST = 30
    const anonStatuses: number[] = []
    for (let i = 0; i < BURST; i++) {
      // eslint-disable-next-line no-await-in-loop -- sequential required for rate limiter
      const r = await fetch(`${BASE_URL}/api/intake/reports`, {
        method: "POST",
        headers: { Origin: ORIGIN },
        body: buildMultipart(
          buildReportJSON(PK, { reporterUserId: null, _dwellMs: 2000 }),
          makePngBlob(),
        ),
      })
      anonStatuses.push(r.status)
    }
    // At least one must have been rate-limited (anon cap applies).
    expect(anonStatuses.some((s) => s === 429)).toBe(true)
    // And the first few should have succeeded (we didn't start over the limit).
    expect(anonStatuses[0]).toBe(201)

    // An authenticated submission goes through (different bucket, higher cap).
    const authed = await fetch(`${BASE_URL}/api/intake/reports`, {
      method: "POST",
      headers: { Origin: ORIGIN },
      body: buildMultipart(
        buildReportJSON(PK, { reporterUserId: "user_1", _dwellMs: 2000 }),
        makePngBlob(),
      ),
    })
    expect(authed.status).toBe(201)
  })
})

describe("intake API — mobile", () => {
  afterEach(async () => {
    await truncateReports()
    await truncateDomain()
  })

  test("mobile intake with source=expo and no Origin header is accepted", async () => {
    const admin = await createUser("admin@example.com", "admin")
    await seedProject({
      name: "Demo Mobile",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: admin,
    })

    const reportJson = JSON.stringify({
      projectKey: PK,
      title: "Crash on settings",
      context: {
        source: "expo",
        pageUrl: "myapp://settings",
        userAgent: "Expo/53 iOS 17.4",
        viewport: { w: 390, h: 844 },
        timestamp: new Date().toISOString(),
      },
      _dwellMs: 1500,
    })

    const res = await fetch(`${BASE_URL}/api/intake/reports`, {
      method: "POST",
      // No Origin header
      body: buildMultipart(reportJson),
    })
    expect(res.status).toBe(201)
  })

  test("web intake with no Origin is still rejected", async () => {
    const admin = await createUser("admin@example.com", "admin")
    await seedProject({
      name: "Demo",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: admin,
    })

    const res = await fetch(`${BASE_URL}/api/intake/reports`, {
      method: "POST",
      body: buildMultipart(buildReportJSON(PK)),
    })
    expect(res.status).toBe(403)
  })

  test("Idempotency-Key causes second submit to return same id without insert", async () => {
    const admin = await createUser("admin@example.com", "admin")
    await seedProject({
      name: "Demo Idem",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: admin,
    })
    const key = "01J9ZZABCDEF1234567890WXYZ"

    const bodyJson = JSON.stringify({
      projectKey: PK,
      title: "first",
      context: {
        source: "expo",
        pageUrl: "myapp://x",
        userAgent: "u",
        viewport: { w: 1, h: 1 },
        timestamp: new Date().toISOString(),
      },
      _dwellMs: 1500,
    })

    const first = await fetch(`${BASE_URL}/api/intake/reports`, {
      method: "POST",
      headers: { "Idempotency-Key": key },
      body: buildMultipart(bodyJson),
    })
    expect(first.status).toBe(201)
    const firstId = ((await first.json()) as { id: string }).id

    const second = await fetch(`${BASE_URL}/api/intake/reports`, {
      method: "POST",
      headers: { "Idempotency-Key": key },
      body: buildMultipart(bodyJson),
    })
    expect(second.status).toBe(200)
    expect(((await second.json()) as { id: string }).id).toBe(firstId)

    const [row] = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(reports)
      .where(sql`project_id = (SELECT id FROM projects WHERE public_key = ${PK})`)
    expect(row.c).toBe(1)
  })

  test("row persists devicePlatform and source on mobile intake", async () => {
    const admin = await createUser("admin@example.com", "admin")
    await seedProject({
      name: "Demo Persist",
      publicKey: PK,
      allowedOrigins: [],
      createdBy: admin,
    })

    const reportJson = JSON.stringify({
      projectKey: PK,
      title: "x",
      context: {
        source: "expo",
        pageUrl: "myapp://x",
        userAgent: "u",
        viewport: { w: 1, h: 1 },
        timestamp: new Date().toISOString(),
        systemInfo: {
          userAgent: "u",
          platform: "android",
          devicePlatform: "android",
          language: "en",
          timezone: "UTC",
          timezoneOffset: 0,
          viewport: { w: 1, h: 1 },
          screen: { w: 1, h: 1 },
          dpr: 2,
          online: true,
          pageUrl: "myapp://x",
          timestamp: new Date().toISOString(),
        },
      },
      _dwellMs: 1500,
    })

    const res = await fetch(`${BASE_URL}/api/intake/reports`, {
      method: "POST",
      body: buildMultipart(reportJson),
    })
    expect(res.status).toBe(201)
    const id = ((await res.json()) as { id: string }).id

    const [row] = await db
      .select({ source: reports.source, devicePlatform: reports.devicePlatform })
      .from(reports)
      .where(sql`id = ${id}`)
    expect(row.source).toBe("expo")
    expect(row.devicePlatform).toBe("android")
  })
})
