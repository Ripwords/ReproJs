// apps/dashboard/tests/api/github-webhook-expanded.test.ts
// Tests for the expanded webhook branches: assigned, milestoned, edited, echo-skip.
import { setup } from "../nuxt-setup"
import { setDefaultTimeout } from "bun:test"
setDefaultTimeout(60000)
import { afterEach, beforeAll, describe, expect, test } from "bun:test"
import { eq, sql } from "drizzle-orm"
import { createHmac } from "node:crypto"
import { db } from "../../server/db"
import {
  githubIntegrations,
  githubWriteLocks,
  reportAssignees,
  reports,
} from "../../server/db/schema"
import { signTitle, signMilestone } from "../../server/lib/github-diff"
import { recordWriteLock } from "../../server/lib/github-write-locks"
import {
  createUser,
  seedGithubApp,
  seedProject,
  truncateDomain,
  truncateGithub,
  truncateGithubApp,
  truncateReports,
} from "../helpers"

// Set webhook secret before the Nuxt dev server starts so the server process
// inherits it (the env singleton is parsed once at module-load time).
process.env.GITHUB_APP_ID = process.env.GITHUB_APP_ID || "12345"
process.env.GITHUB_APP_PRIVATE_KEY =
  process.env.GITHUB_APP_PRIVATE_KEY ||
  "-----BEGIN RSA PRIVATE KEY-----\ntest\n-----END RSA PRIVATE KEY-----"
process.env.GITHUB_APP_WEBHOOK_SECRET = "test-webhook-secret"

await setup({ server: true, port: 3000, host: "localhost" })

const BASE_URL = process.env.TEST_BASE_URL ?? "http://localhost:3000"

const PK = "rp_pk_WEBHOOKEXPANDED12345678"
const ORIGIN = "http://localhost:4000"
const SECRET = "test-webhook-secret"

function sign(secret: string, payload: string): string {
  const h = createHmac("sha256", secret)
  h.update(payload)
  return `sha256=${h.digest("hex")}`
}

async function sendWebhook(eventName: string, body: unknown) {
  const raw = JSON.stringify(body)
  const res = await fetch(`${BASE_URL}/api/integrations/github/webhook`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-github-event": eventName,
      "x-github-delivery": crypto.randomUUID(),
      "x-hub-signature-256": sign(SECRET, raw),
    },
    body: raw,
  })
  return res
}

beforeAll(async () => {
  process.env.ATTACHMENT_URL_SECRET = process.env.ATTACHMENT_URL_SECRET ?? "test-attachment-secret"
  await truncateGithubApp()
  await seedGithubApp()
})

async function truncateWriteLocks() {
  await db.execute(sql`TRUNCATE github_write_locks RESTART IDENTITY CASCADE`)
}

async function seedLinkedReport() {
  const ownerId = await createUser("owner@example.com", "admin")
  const pid = await seedProject({
    name: "wh-expanded",
    publicKey: PK,
    allowedOrigins: [ORIGIN],
    createdBy: ownerId,
  })
  await db.insert(githubIntegrations).values({
    projectId: pid,
    installationId: 10,
    repoOwner: "acme",
    repoName: "frontend",
    status: "connected",
  })
  const [r] = await db
    .insert(reports)
    .values({
      projectId: pid,
      title: "Original title",
      description: "test",
      context: {
        pageUrl: "http://example.com",
        userAgent: "UA",
        viewport: { w: 1, h: 1 },
        timestamp: new Date().toISOString(),
      },
      githubIssueNumber: 42,
      githubIssueNodeId: "NODE_42",
      githubIssueUrl: "https://github.com/acme/frontend/issues/42",
    })
    .returning()
  return { pid, reportId: r.id }
}

describe("webhook expanded — new event branches", () => {
  afterEach(async () => {
    await truncateWriteLocks()
    await truncateGithub()
    await truncateReports()
    await truncateDomain()
  })

  test("issues.assigned populates report_assignees", async () => {
    const { reportId } = await seedLinkedReport()

    const res = await sendWebhook("issues", {
      action: "assigned",
      issue: {
        number: 42,
        title: "Original title",
        state: "open",
        labels: [],
        assignees: [{ login: "alice", id: 1001, avatar_url: "https://github.com/alice.png" }],
        milestone: null,
      },
      repository: { name: "frontend", owner: { login: "acme" } },
    })
    expect(res.status).toBe(202)

    const assignees = await db
      .select()
      .from(reportAssignees)
      .where(eq(reportAssignees.reportId, reportId))
    expect(assignees.length).toBe(1)
    expect(assignees[0]?.githubLogin).toBe("alice")
    expect(assignees[0]?.githubUserId).toBe("1001")
  })

  test("issues.milestoned updates milestone columns", async () => {
    const { reportId } = await seedLinkedReport()

    const res = await sendWebhook("issues", {
      action: "milestoned",
      issue: {
        number: 42,
        title: "Original title",
        state: "open",
        labels: [],
        assignees: [],
        milestone: { number: 7, title: "v1.0" },
      },
      repository: { name: "frontend", owner: { login: "acme" } },
    })
    expect(res.status).toBe(202)

    const [row] = await db.select().from(reports).where(eq(reports.id, reportId))
    expect(row?.milestoneNumber).toBe(7)
    expect(row?.milestoneTitle).toBe("v1.0")
  })

  test("issues.demilestoned clears milestone", async () => {
    const { reportId } = await seedLinkedReport()
    // Seed a milestone first
    await db
      .update(reports)
      .set({ milestoneNumber: 7, milestoneTitle: "v1.0" })
      .where(eq(reports.id, reportId))

    const res = await sendWebhook("issues", {
      action: "demilestoned",
      issue: {
        number: 42,
        title: "Original title",
        state: "open",
        labels: [],
        assignees: [],
        milestone: null,
      },
      repository: { name: "frontend", owner: { login: "acme" } },
    })
    expect(res.status).toBe(202)

    const [row] = await db.select().from(reports).where(eq(reports.id, reportId))
    expect(row?.milestoneNumber).toBeNull()
    expect(row?.milestoneTitle).toBeNull()
  })

  test("issues.edited with title change updates reports.title", async () => {
    const { reportId } = await seedLinkedReport()

    const res = await sendWebhook("issues", {
      action: "edited",
      issue: {
        number: 42,
        title: "New title from GitHub",
        state: "open",
        labels: [],
        assignees: [],
        milestone: null,
      },
      changes: { title: { from: "Original title" } },
      repository: { name: "frontend", owner: { login: "acme" } },
    })
    expect(res.status).toBe(202)

    const [row] = await db.select().from(reports).where(eq(reports.id, reportId))
    expect(row?.title).toBe("New title from GitHub")
  })

  test("echo: pre-seeded title write-lock consumes and skips inbound title change", async () => {
    const { reportId } = await seedLinkedReport()
    const newTitle = "Title we just pushed to GitHub"

    // Simulate having just pushed a title update — record a write-lock
    await recordWriteLock(db, {
      reportId,
      kind: "title",
      signature: signTitle(newTitle),
    })

    // Update the DB title to the new value (as if we already applied it outbound)
    await db.update(reports).set({ title: newTitle }).where(eq(reports.id, reportId))

    // Send the matching webhook back (GitHub echo)
    const res = await sendWebhook("issues", {
      action: "edited",
      issue: {
        number: 42,
        title: newTitle,
        state: "open",
        labels: [],
        assignees: [],
        milestone: null,
      },
      changes: { title: { from: "Original title" } },
      repository: { name: "frontend", owner: { login: "acme" } },
    })
    expect(res.status).toBe(202)

    // Write-lock should be consumed
    const locks = await db
      .select()
      .from(githubWriteLocks)
      .where(eq(githubWriteLocks.reportId, reportId))
    expect(locks.length).toBe(0)

    // Title should remain the value we set (no spurious revert)
    const [row] = await db.select().from(reports).where(eq(reports.id, reportId))
    expect(row?.title).toBe(newTitle)
  })

  test("echo: pre-seeded milestone lock skips inbound milestone change", async () => {
    const { reportId } = await seedLinkedReport()
    const milestoneNumber = 5

    // Record a write-lock for the milestone
    await recordWriteLock(db, {
      reportId,
      kind: "milestone",
      signature: signMilestone(milestoneNumber),
    })

    // Seed the milestone in the DB (as if we already applied it outbound)
    await db
      .update(reports)
      .set({ milestoneNumber, milestoneTitle: "v2.0" })
      .where(eq(reports.id, reportId))

    const res = await sendWebhook("issues", {
      action: "milestoned",
      issue: {
        number: 42,
        title: "Original title",
        state: "open",
        labels: [],
        assignees: [],
        milestone: { number: milestoneNumber, title: "v2.0" },
      },
      repository: { name: "frontend", owner: { login: "acme" } },
    })
    expect(res.status).toBe(202)

    // Lock consumed
    const locks = await db
      .select()
      .from(githubWriteLocks)
      .where(eq(githubWriteLocks.reportId, reportId))
    expect(locks.length).toBe(0)

    // Milestone unchanged
    const [row] = await db.select().from(reports).where(eq(reports.id, reportId))
    expect(row?.milestoneNumber).toBe(milestoneNumber)
  })
})
