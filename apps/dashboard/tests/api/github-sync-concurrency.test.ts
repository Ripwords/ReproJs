// Regression tests for audit 2026-10-26 §4 high #3: duplicate GitHub issues
// from concurrent reconciles, and enqueue resetting a `syncing` row.
import { setup } from "../nuxt-setup"
import { afterEach, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import { and, eq } from "drizzle-orm"
import { __setClientOverride } from "../../server/lib/github"
import { enqueueSync } from "../../server/lib/enqueue-sync"
import { reconcileReport } from "../../server/lib/github-reconcile"
import { _processClaimedJobForTesting } from "../../server/lib/github-sync-runner"
import { db } from "../../server/db"
import { githubIntegrations, reports, reportSyncJobs } from "../../server/db/schema"
import {
  createUser,
  seedGithubApp,
  seedProject,
  truncateDomain,
  truncateGithub,
  truncateGithubApp,
  truncateReports,
  waitForSyncTriggerSettle,
} from "../helpers"
import type { GitHubInstallationClient } from "@reprojs/integrations-github"

await setup({ server: true, port: 3000, host: "localhost" })
setDefaultTimeout(60000)

const PK = "rp_pk_SYNCCONCURRENCY000000000"
const ORIGIN = "http://localhost:4000"

interface MockCalls {
  createIssue: Array<Record<string, unknown>>
  getIssue: Array<Record<string, unknown>>
}

// Facade-only mock (same shape as github-sync.test.ts's makeMock, duplicated
// so importing it doesn't register that file's tests here too).
function makeMock(overrides: Partial<GitHubInstallationClient> = {}): {
  client: GitHubInstallationClient
  calls: MockCalls
} {
  const calls: MockCalls = { createIssue: [], getIssue: [] }
  const defaults = {
    createIssue: async (input: unknown) => {
      calls.createIssue.push(input as Record<string, unknown>)
      return { number: 42, nodeId: "NODE_42", url: "https://github.com/acme/frontend/issues/42" }
    },
    getIssue: async (input: unknown) => {
      calls.getIssue.push(input as Record<string, unknown>)
      return { state: "open" as const, labels: [] as string[] }
    },
    closeIssue: async () => {},
    reopenIssue: async () => {},
    updateIssueLabels: async () => {},
    listInstallationRepositories: async () => [],
    findIssueByMarker: async () => null,
  } as unknown as GitHubInstallationClient
  return { client: { ...defaults, ...overrides }, calls }
}

async function seedConnectedReport() {
  const ownerId = await createUser("owner-concurrency@example.com", "admin")
  const pid = await seedProject({
    name: "concurrency",
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
      title: "Crash",
      description: "it crashed",
      context: {
        pageUrl: "https://app.example.com",
        userAgent: "UA",
        viewport: { w: 1, h: 1 },
        timestamp: new Date().toISOString(),
      },
    })
    .returning({ id: reports.id })
  if (!r) throw new Error("seed failed")
  return { pid, reportId: r.id }
}

beforeAll(async () => {
  await truncateGithubApp()
  await seedGithubApp()
})

describe("github sync — concurrency", () => {
  afterEach(async () => {
    __setClientOverride(null)
    await truncateGithub()
    await truncateReports()
    await truncateDomain()
  })

  test("two overlapping reconciles of an unlinked report create exactly one issue", async () => {
    const { reportId } = await seedConnectedReport()
    const { client, calls } = makeMock({
      // Slow create so both runs are genuinely in flight at once.
      createIssue: async (input) => {
        calls.createIssue.push(input as unknown as Record<string, unknown>)
        await new Promise((r) => setTimeout(r, 150))
        return { number: 42, nodeId: "NODE_42", url: "https://github.com/acme/frontend/issues/42" }
      },
    })
    __setClientOverride(() => client)

    await Promise.all([reconcileReport(reportId), reconcileReport(reportId)])

    expect(calls.createIssue.length).toBe(1)
    const [row] = await db
      .select({ n: reports.githubIssueNumber })
      .from(reports)
      .where(eq(reports.id, reportId))
    expect(row?.n).toBe(42)
  })

  test("enqueue during `syncing` flags a rerun instead of resetting the row, and the runner requeues once", async () => {
    const { pid, reportId } = await seedConnectedReport()
    // A worker has claimed the row and is mid-reconcile.
    await db.insert(reportSyncJobs).values({
      reportId,
      signature: "reconcile",
      state: "syncing",
      payload: { kind: "reconcile" },
    })

    await enqueueSync(reportId, pid)

    const key = and(
      eq(reportSyncJobs.reportId, reportId),
      eq(reportSyncJobs.signature, "reconcile"),
    )
    const [afterEnqueue] = await db.select().from(reportSyncJobs).where(key)
    expect(afterEnqueue?.state).toBe("syncing")
    expect(afterEnqueue?.rerunRequested).toBe(true)

    // The in-flight worker finishes. Before the fix the row had been flipped
    // to `pending`, so this DELETE'd it and the mid-flight write was lost.
    const { client, calls } = makeMock()
    __setClientOverride(() => client)
    await _processClaimedJobForTesting(afterEnqueue!)
    await waitForSyncTriggerSettle(1500)

    // One create from the first pass, then the requeued pass ran the
    // extended reconcile against the now-linked issue and completed.
    expect(calls.createIssue.length).toBe(1)
    expect(calls.getIssue.length).toBeGreaterThanOrEqual(1)
    const remaining = await db.select().from(reportSyncJobs).where(key)
    expect(remaining).toHaveLength(0)
  })

  test("enqueue on a `failed` row makes it runnable again", async () => {
    const { pid, reportId } = await seedConnectedReport()
    await db.insert(reportSyncJobs).values({
      reportId,
      signature: "reconcile",
      state: "failed",
      attempts: 1,
      nextAttemptAt: new Date(Date.now() + 3_600_000),
      payload: { kind: "reconcile" },
    })
    // No client override: the trigger's reconcile fails fast (no GitHub App
    // creds) and the row goes back to pending with backoff — fine, we only
    // assert on the enqueue itself.
    await enqueueSync(reportId, pid)
    await waitForSyncTriggerSettle()
    const [row] = await db
      .select()
      .from(reportSyncJobs)
      .where(and(eq(reportSyncJobs.reportId, reportId), eq(reportSyncJobs.signature, "reconcile")))
    expect(row?.rerunRequested).toBe(false)
    expect(row?.state).not.toBe("failed")
  })
})
