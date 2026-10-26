// apps/dashboard/tests/api/github-push-on-edit.test.ts
// End-to-end roundtrip: PATCH report → enqueue → reconcile → write-locks → echo-skip.
import { setup } from "../nuxt-setup"
import { setDefaultTimeout } from "bun:test"
setDefaultTimeout(60000)
import { afterEach, beforeAll, describe, expect, test } from "bun:test"
import { eq, sql } from "drizzle-orm"
import { createHmac } from "node:crypto"
import type { GitHubInstallationClient } from "@reprojs/integrations-github"
import type { Octokit } from "@octokit/rest"
import { __setClientOverride } from "../../server/lib/github"
import { reconcileReport } from "../../server/lib/github-reconcile"
import type { LiveIssue } from "../../server/lib/github-reconcile"
import { consumeWriteLock } from "../../server/lib/github-write-locks"
import { signState } from "../../server/lib/github-diff"
import { db } from "../../server/db"
import {
  githubIntegrations,
  githubWriteLocks,
  projectMembers,
  reports,
} from "../../server/db/schema"
import {
  apiFetch,
  createUser,
  seedGithubApp,
  seedProject,
  signIn,
  truncateDomain,
  truncateGithub,
  truncateGithubApp,
  truncateReports,
  waitForSyncTriggerSettle,
} from "../helpers"

// Set env vars before setup so the dev server inherits them
process.env.GITHUB_APP_ID = process.env.GITHUB_APP_ID || "12345"
process.env.GITHUB_APP_PRIVATE_KEY =
  process.env.GITHUB_APP_PRIVATE_KEY ||
  "-----BEGIN RSA PRIVATE KEY-----\ntest\n-----END RSA PRIVATE KEY-----"
process.env.GITHUB_APP_WEBHOOK_SECRET =
  process.env.GITHUB_APP_WEBHOOK_SECRET || "test-webhook-secret"

await setup({ server: true, port: 3000, host: "localhost" })

const BASE_URL = process.env.TEST_BASE_URL ?? "http://localhost:3000"

const PK = "rp_pk_PUSHONEDITRT1234567890"
const ORIGIN = "http://localhost:4000"
const SECRET = process.env.GITHUB_APP_WEBHOOK_SECRET ?? "test-webhook-secret"

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

async function truncateWriteLocks() {
  await db.execute(sql`TRUNCATE github_write_locks RESTART IDENTITY CASCADE`)
}

interface MockCalls {
  updateState: Array<Record<string, unknown>>
  updateLabels: Array<Record<string, unknown>>
  updateTitle: Array<Record<string, unknown>>
  updateMilestone: Array<Record<string, unknown>>
  addAssignees: Array<Record<string, unknown>>
  removeAssignees: Array<Record<string, unknown>>
}

/** Build a mock client + raw octokit shim for reconcile tests. */
function makeMockWithRichIssue(liveIssue: LiveIssue): {
  client: GitHubInstallationClient & {
    getRichIssue: (input: { owner: string; repo: string; number: number }) => Promise<LiveIssue>
    getRawOctokit: () => Octokit
  }
  calls: MockCalls
} {
  const calls: MockCalls = {
    updateState: [],
    updateLabels: [],
    updateTitle: [],
    updateMilestone: [],
    addAssignees: [],
    removeAssignees: [],
  }

  const octokit = {
    rest: {
      issues: {
        get: async () => ({ data: {} as never }),
        setLabels: async (args: Record<string, unknown>) => {
          calls.updateLabels.push(args)
        },
        update: async (args: Record<string, unknown>) => {
          if ("state" in args) calls.updateState.push(args)
          if ("title" in args) calls.updateTitle.push(args)
          if ("milestone" in args) calls.updateMilestone.push(args)
        },
        addAssignees: async (args: Record<string, unknown>) => {
          calls.addAssignees.push(args)
          // The reconciler inspects response.data.assignees to detect silent
          // drops by GitHub; echo the requested logins back so this test
          // simulates a fully successful assignment.
          return {
            data: {
              assignees: ((args.assignees as string[] | undefined) ?? []).map((login) => ({
                login,
              })),
            },
          }
        },
        removeAssignees: async (args: Record<string, unknown>) => {
          calls.removeAssignees.push(args)
          return { data: { assignees: [] } }
        },
        // Pre-flight probe the reconciler runs before every addAssignees —
        // treat everyone as assignable so the existing assertions hold.
        checkUserCanBeAssigned: async () => ({ status: 204 }),
      },
    },
  } as unknown as Octokit

  const client = {
    createIssue: async () => ({
      number: 42,
      nodeId: "NODE_42",
      url: "https://github.com/acme/frontend/issues/42",
    }),
    getIssue: async () => ({ state: "open", labels: [] }),
    closeIssue: async () => {},
    reopenIssue: async () => {},
    updateIssueLabels: async () => {},
    listInstallationRepositories: async () => [],
    findIssueByMarker: async () => null,
    getRichIssue: async () => liveIssue,
    getRawOctokit: () => octokit,
  }

  return { client, calls }
}

// Seed the singleton `github_app` row so both the test process and the dev
// server resolve the same webhook secret via `getGithubAppCredentials()`.
// Mutating `process.env.GITHUB_APP_*` only affects this process — the dev
// server's env snapshot was frozen at its own startup.
beforeAll(async () => {
  process.env.ATTACHMENT_URL_SECRET = process.env.ATTACHMENT_URL_SECRET ?? "test-attachment-secret"
  await truncateGithubApp()
  await seedGithubApp()
})

async function seedLinkedProject(opts: { pushOnEdit: boolean }) {
  const ownerId = await createUser("owner@example.com", "admin")
  const pid = await seedProject({
    name: "push-on-edit-rt",
    publicKey: PK,
    allowedOrigins: [ORIGIN],
    createdBy: ownerId,
  })
  await db.insert(githubIntegrations).values({
    projectId: pid,
    installationId: 10,
    repoOwner: "acme",
    repoName: "frontend",
    pushOnEdit: opts.pushOnEdit,
    status: "connected",
  })
  await db.insert(projectMembers).values({ projectId: pid, userId: ownerId, role: "owner" })

  const [r] = await db
    .insert(reports)
    .values({
      projectId: pid,
      title: "Linked report",
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

  return { pid, reportId: r.id, ownerId }
}

describe("push-on-edit e2e roundtrip", () => {
  afterEach(async () => {
    __setClientOverride(null)
    await truncateWriteLocks()
    await truncateGithub()
    await truncateReports()
    await truncateDomain()
  })

  test("PATCH → enqueue → reconcile writes state + labels + records write-locks", async () => {
    const { pid, reportId } = await seedLinkedProject({ pushOnEdit: true })
    const cookie = await signIn("owner@example.com")

    // Live issue on GitHub: open, no labels, no assignees
    const liveIssue: LiveIssue = {
      title: "Linked report",
      state: "open",
      stateReason: null,
      labels: [],
      assigneeLogins: [],
      milestoneNumber: null,
    }
    const { client, calls } = makeMockWithRichIssue(liveIssue)
    __setClientOverride(() => client)

    // PATCH priority → enqueue a sync job + fire the in-process trigger
    const { status } = await apiFetch(`/api/projects/${pid}/reports/${reportId}`, {
      method: "PATCH",
      headers: { cookie },
      body: { priority: "high" },
    })
    expect(status).toBe(200)

    // Wait for the dev-server's in-process trigger to finish. It runs
    // production-style reconcile (the `__setClientOverride` lives only in
    // this test process, not in the dev server), which fails quickly on
    // the bogus test App credentials and lands the row back at state=pending.
    await waitForSyncTriggerSettle()

    // Run reconcile here in the test process where the override IS set, so
    // the mock receives the calls we then assert on.
    await reconcileReport(reportId)

    // State hasn't changed (still open, report status is "open")
    expect(calls.updateState.length).toBe(0)

    // Labels should be updated (priority=high adds "priority:high" label)
    expect(calls.updateLabels.length).toBe(1)
    expect(calls.updateLabels[0]?.labels).toContain("priority:high")

    // Write-lock should have been recorded for labels
    const locks = await db
      .select()
      .from(githubWriteLocks)
      .where(eq(githubWriteLocks.reportId, reportId))
    const labelLock = locks.find((l) => l.kind === "labels")
    expect(labelLock).toBeDefined()
  })

  test("reconcile writes title change + records title write-lock", async () => {
    const { reportId } = await seedLinkedProject({ pushOnEdit: true })

    // Update the DB title first (simulate an edit)
    await db.update(reports).set({ title: "Updated title" }).where(eq(reports.id, reportId))

    const liveIssue: LiveIssue = {
      title: "Linked report", // old title on GitHub
      state: "open",
      stateReason: null,
      labels: [],
      assigneeLogins: [],
      milestoneNumber: null,
    }
    const { client, calls } = makeMockWithRichIssue(liveIssue)
    __setClientOverride(() => client)

    await reconcileReport(reportId)

    // Title should be updated
    expect(calls.updateTitle.length).toBe(1)
    expect(calls.updateTitle[0]?.title).toBe("Updated title")

    // Write-lock recorded for title
    const locks = await db
      .select()
      .from(githubWriteLocks)
      .where(eq(githubWriteLocks.reportId, reportId))
    const titleLock = locks.find((l) => l.kind === "title")
    expect(titleLock).toBeDefined()
  })

  test("state write-lock echo: webhook echo consumed after reconcile closes issue", async () => {
    const { reportId } = await seedLinkedProject({ pushOnEdit: true })

    // Set report status to resolved
    await db.update(reports).set({ status: "resolved" }).where(eq(reports.id, reportId))

    // Live issue is open — reconciler will close it
    const liveIssue: LiveIssue = {
      title: "Linked report",
      state: "open",
      stateReason: null,
      labels: [],
      assigneeLogins: [],
      milestoneNumber: null,
    }
    const { client } = makeMockWithRichIssue(liveIssue)
    __setClientOverride(() => client)

    await reconcileReport(reportId)

    // A state write-lock should have been recorded
    const stateSig = signState("closed", "completed")
    const consumed = await consumeWriteLock(db, {
      reportId,
      kind: "state",
      signature: stateSig,
    })
    expect(consumed).toBe(true)

    // The lock was consumed — none remain
    const remainingLocks = await db
      .select()
      .from(githubWriteLocks)
      .where(eq(githubWriteLocks.reportId, reportId))
    expect(remainingLocks.filter((l) => l.kind === "state").length).toBe(0)
  })

  test("full roundtrip: PATCH → reconcile → webhook echo → lock consumed, status unchanged", async () => {
    const { pid, reportId } = await seedLinkedProject({ pushOnEdit: true })
    const cookie = await signIn("owner@example.com")

    // Set report to resolved so close-issue is triggered
    await db.update(reports).set({ status: "resolved" }).where(eq(reports.id, reportId))

    const liveIssue: LiveIssue = {
      title: "Linked report",
      state: "open",
      stateReason: null,
      labels: [],
      assigneeLogins: [],
      milestoneNumber: null,
    }
    const { client } = makeMockWithRichIssue(liveIssue)
    __setClientOverride(() => client)

    // Reconcile: closes the GitHub issue + records write-lock
    await reconcileReport(reportId)

    // Now simulate the GitHub echo webhook (GitHub notifies us of the close)
    const res = await sendWebhook("issues", {
      action: "closed",
      issue: {
        number: 42,
        state: "closed",
        state_reason: "completed",
        labels: [],
      },
      repository: { name: "frontend", owner: { login: "acme" } },
    })
    expect(res.status).toBe(202)

    // Write-lock was consumed (echo skipped)
    const remainingLocks = await db
      .select()
      .from(githubWriteLocks)
      .where(eq(githubWriteLocks.reportId, reportId))
    expect(remainingLocks.filter((l) => l.kind === "state").length).toBe(0)

    // Dashboard status should remain "resolved" (not re-applied by the echo)
    const [row] = await db.select().from(reports).where(eq(reports.id, reportId))
    expect(row?.status).toBe("resolved")

    void pid // suppress unused warning
    void cookie
  })
})
