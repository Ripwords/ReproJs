// apps/dashboard/tests/api/auto-create-on-intake.test.ts
// Tests for the autoCreateOnIntake conditional enqueue in the intake endpoint.
import { setup } from "../nuxt-setup"
import { setDefaultTimeout } from "bun:test"
setDefaultTimeout(60000)
import { afterEach, describe, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import { db } from "../../server/db"
import { githubIntegrations, projectMembers, reports, reportSyncJobs } from "../../server/db/schema"
import {
  createUser,
  makePngBlob,
  seedProject,
  truncateDomain,
  truncateGithub,
  truncateReports,
  waitForSyncTriggerSettle,
} from "../helpers"

await setup({ server: true, port: 3000, host: "localhost" })

const BASE_URL = process.env.TEST_BASE_URL ?? "http://localhost:3000"

const PK = "rp_pk_AUTOCREATE12345678901234"
const ORIGIN = "http://localhost:4000"

function buildReportJSON(projectKey: string): string {
  return JSON.stringify({
    projectKey,
    title: "Auto-create test report",
    description: "Testing autoCreateOnIntake toggle",
    context: {
      pageUrl: "http://localhost:4000/app",
      userAgent: "Mozilla/5.0 Test",
      viewport: { w: 1440, h: 900 },
      timestamp: new Date().toISOString(),
    },
    _dwellMs: 2000,
  })
}

function buildMultipart(reportJson: string, screenshot?: Blob): FormData {
  const fd = new FormData()
  fd.set("report", new Blob([reportJson], { type: "application/json" }))
  if (screenshot) fd.set("screenshot", screenshot, "screenshot.png")
  return fd
}

async function seedConnectedProject(opts: { autoCreateOnIntake: boolean }) {
  const ownerId = await createUser("owner@example.com", "admin")
  const pid = await seedProject({
    name: "auto-create-test",
    publicKey: PK,
    allowedOrigins: [ORIGIN],
    createdBy: ownerId,
  })
  await db.insert(githubIntegrations).values({
    projectId: pid,
    installationId: 42,
    repoOwner: "acme",
    repoName: "frontend",
    autoCreateOnIntake: opts.autoCreateOnIntake,
    status: "connected",
  })
  await db.insert(projectMembers).values({ projectId: pid, userId: ownerId, role: "owner" })
  return { pid, ownerId }
}

describe("intake — autoCreateOnIntake", () => {
  afterEach(async () => {
    await truncateGithub()
    await truncateReports()
    await truncateDomain()
  })

  test("toggle ON → POST intake → exactly one pending sync job for the new report", async () => {
    await seedConnectedProject({ autoCreateOnIntake: true })

    const res = await fetch(`${BASE_URL}/api/intake/reports`, {
      method: "POST",
      headers: { Origin: ORIGIN },
      body: buildMultipart(buildReportJSON(PK), makePngBlob()),
    })
    expect(res.status).toBe(201)
    const { id } = (await res.json()) as { id: string }

    // The in-process trigger fires right after the intake write; wait for
    // it to settle before asserting on `state`. Without a github_app row
    // configured here, reconcile errors out and the row backs off to
    // `state='pending'` with attempts=1 — the assertion holds either way.
    await waitForSyncTriggerSettle()

    const jobs = await db.select().from(reportSyncJobs).where(eq(reportSyncJobs.reportId, id))
    expect(jobs.length).toBe(1)
    expect(jobs[0]?.state).toBe("pending")
  })

  test("toggle OFF → POST intake → no sync job enqueued", async () => {
    await seedConnectedProject({ autoCreateOnIntake: false })

    const res = await fetch(`${BASE_URL}/api/intake/reports`, {
      method: "POST",
      headers: { Origin: ORIGIN },
      body: buildMultipart(buildReportJSON(PK), makePngBlob()),
    })
    expect(res.status).toBe(201)
    const { id } = (await res.json()) as { id: string }

    const jobs = await db.select().from(reportSyncJobs).where(eq(reportSyncJobs.reportId, id))
    expect(jobs.length).toBe(0)
  })

  test("flip OFF→ON does NOT backfill pre-existing unlinked reports", async () => {
    const { pid } = await seedConnectedProject({ autoCreateOnIntake: false })

    // Insert a report that existed before the toggle was enabled.
    const [existingReport] = await db
      .insert(reports)
      .values({
        projectId: pid,
        title: "Pre-existing report",
        description: "existed before toggle",
        context: {
          pageUrl: "http://localhost:4000/old",
          userAgent: "UA",
          viewport: { w: 1440, h: 900 },
          timestamp: new Date().toISOString(),
        },
      })
      .returning()

    // Flip the toggle on.
    await db
      .update(githubIntegrations)
      .set({ autoCreateOnIntake: true })
      .where(eq(githubIntegrations.projectId, pid))

    // No sync job should appear for the pre-existing report — the flip is not
    // a backfill trigger, only future intakes enqueue automatically.
    const jobs = await db
      .select()
      .from(reportSyncJobs)
      .where(eq(reportSyncJobs.reportId, existingReport.id))
    expect(jobs.length).toBe(0)
  })
})
