// apps/dashboard/tests/api/github-sync.test.ts
import { setup } from "../nuxt-setup"
import { setDefaultTimeout } from "bun:test"
setDefaultTimeout(60000)
import { afterEach, beforeAll, describe, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import type { GitHubInstallationClient } from "@reprojs/integrations-github"
import { __setClientOverride, signInstallState } from "../../server/lib/github"
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
import { db } from "../../server/db"
import {
  githubIntegrations,
  projectMembers,
  reports,
  reportEvents,
  reportSyncJobs,
} from "../../server/db/schema"
import { createHmac } from "node:crypto"
import { reconcileReport } from "../../server/lib/github-reconcile"

await setup({ server: true, port: 3000, host: "localhost" })

const BASE_URL = process.env.TEST_BASE_URL ?? "http://localhost:3000"

const PK = "rp_pk_GHUB1234567890abcdef1234"
const ORIGIN = "http://localhost:4000"

interface MockCalls {
  createIssue: Array<Record<string, unknown>>
  closeIssue: Array<Record<string, unknown>>
  reopenIssue: Array<Record<string, unknown>>
  updateIssueLabels: Array<Record<string, unknown>>
  getIssue: Array<Record<string, unknown>>
}

export function makeMock(overrides: Partial<GitHubInstallationClient> = {}): {
  client: GitHubInstallationClient
  calls: MockCalls
} {
  const calls: MockCalls = {
    createIssue: [],
    closeIssue: [],
    reopenIssue: [],
    updateIssueLabels: [],
    getIssue: [],
  }
  const defaults: GitHubInstallationClient = {
    createIssue: async (input) => {
      calls.createIssue.push(input as unknown as Record<string, unknown>)
      return { number: 42, nodeId: "NODE_42", url: "https://github.com/acme/frontend/issues/42" }
    },
    getIssue: async (input) => {
      calls.getIssue.push(input as unknown as Record<string, unknown>)
      return { state: "open", labels: [] }
    },
    closeIssue: async (input) => {
      calls.closeIssue.push(input as unknown as Record<string, unknown>)
    },
    reopenIssue: async (input) => {
      calls.reopenIssue.push(input as unknown as Record<string, unknown>)
    },
    updateIssueLabels: async (input) => {
      calls.updateIssueLabels.push(input as unknown as Record<string, unknown>)
    },
    listInstallationRepositories: async () => [
      { id: 1, owner: "acme", name: "frontend", fullName: "acme/frontend" },
    ],
    findIssueByMarker: async () => null,
  }
  return { client: { ...defaults, ...overrides }, calls }
}

// The dev server reads GitHub App credentials from the DB via
// `getGithubAppCredentials()`. Seeding the singleton `github_app` row is the
// only way both processes (test + dev server) agree on the webhook secret
// used for install-state HMACs — mutating `process.env` here only affects
// the test process.
beforeAll(async () => {
  process.env.ATTACHMENT_URL_SECRET = process.env.ATTACHMENT_URL_SECRET ?? "test-attachment-secret"
  await truncateGithubApp()
  await seedGithubApp()
})

describe("github integration — install + config", () => {
  afterEach(async () => {
    __setClientOverride(null)
    await truncateGithub()
    await truncateReports()
    await truncateDomain()
  })

  test("install-callback with valid state upserts github_integrations row", async () => {
    const owner = await createUser("owner@example.com", "admin")
    const pid = await seedProject({
      name: "g",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: owner,
    })
    const state = await signInstallState({
      projectId: pid,
      userId: owner,
      exp: Math.floor(Date.now() / 1000) + 600,
    })
    const res = await fetch(
      `${BASE_URL}/api/integrations/github/install-callback?installation_id=99&state=${encodeURIComponent(state)}`,
      { redirect: "manual" },
    )
    expect(res.status).toBe(302)
    const [row] = await db
      .select()
      .from(githubIntegrations)
      .where(eq(githubIntegrations.projectId, pid))
    expect(row?.installationId).toBe(99)
    expect(row?.status).toBe("connected")
  })

  test("install-callback rejects invalid state", async () => {
    const res = await fetch(
      `${BASE_URL}/api/integrations/github/install-callback?installation_id=1&state=bogus.bogus`,
      { redirect: "manual" },
    )
    expect(res.status).toBe(401)
  })

  test("PATCH updates repo + defaults", async () => {
    const owner = await createUser("owner@example.com", "admin")
    const pid = await seedProject({
      name: "g",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: owner,
    })
    await db
      .insert(githubIntegrations)
      .values({ projectId: pid, installationId: 10, repoOwner: "", repoName: "" })
    const cookie = await signIn("owner@example.com")
    const { status } = await apiFetch(`/api/projects/${pid}/integrations/github`, {
      method: "PATCH",
      headers: { cookie },
      body: {
        repoOwner: "acme",
        repoName: "frontend",
        defaultLabels: ["feedback"],
        defaultAssignees: ["@priya"],
      },
    })
    expect(status).toBe(200)
    const [row] = await db
      .select()
      .from(githubIntegrations)
      .where(eq(githubIntegrations.projectId, pid))
    expect(row?.repoOwner).toBe("acme")
    expect(row?.defaultLabels).toEqual(["feedback"])
  })

  test("disconnect flips status", async () => {
    const owner = await createUser("owner@example.com", "admin")
    const pid = await seedProject({
      name: "g",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: owner,
    })
    await db
      .insert(githubIntegrations)
      .values({ projectId: pid, installationId: 10, repoOwner: "acme", repoName: "frontend" })
    const cookie = await signIn("owner@example.com")
    const { status } = await apiFetch(`/api/projects/${pid}/integrations/github/disconnect`, {
      method: "POST",
      headers: { cookie },
    })
    expect(status).toBe(200)
    const [row] = await db
      .select()
      .from(githubIntegrations)
      .where(eq(githubIntegrations.projectId, pid))
    expect(row?.status).toBe("disconnected")
  })

  test("GET config returns the shape with no integration", async () => {
    const owner = await createUser("owner@example.com", "admin")
    const pid = await seedProject({
      name: "g",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: owner,
    })
    const cookie = await signIn("owner@example.com")
    const { body } = await apiFetch<{ installed: boolean }>(
      `/api/projects/${pid}/integrations/github`,
      { headers: { cookie } },
    )
    expect(body.installed).toBe(false)
  })

  test("GET repositories 409s when integration is not connected", async () => {
    const owner = await createUser("owner@example.com", "admin")
    const pid = await seedProject({
      name: "g",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: owner,
    })
    const cookie = await signIn("owner@example.com")
    const res = await apiFetch(`/api/projects/${pid}/integrations/github/repositories`, {
      headers: { cookie },
    })
    expect(res.status).toBe(409)
  })

  test("viewer cannot PATCH or disconnect", async () => {
    const owner = await createUser("owner@example.com", "admin")
    const viewer = await createUser("viewer@example.com", "member")
    const pid = await seedProject({
      name: "g",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: owner,
    })
    await db.insert(githubIntegrations).values({
      projectId: pid,
      installationId: 10,
      repoOwner: "acme",
      repoName: "frontend",
    })
    await db.insert(projectMembers).values({ projectId: pid, userId: viewer, role: "viewer" })
    const cookie = await signIn("viewer@example.com")
    const r1 = await apiFetch(`/api/projects/${pid}/integrations/github`, {
      method: "PATCH",
      headers: { cookie },
      body: { defaultLabels: ["x"] },
    })
    expect(r1.status).toBe(403)
    const r2 = await apiFetch(`/api/projects/${pid}/integrations/github/disconnect`, {
      method: "POST",
      headers: { cookie },
    })
    expect(r2.status).toBe(403)
  })
})

function sign(secret: string, payload: string): string {
  const h = createHmac("sha256", secret)
  h.update(payload)
  return `sha256=${h.digest("hex")}`
}

describe("worker reconcile", () => {
  afterEach(async () => {
    __setClientOverride(null)
    await truncateGithub()
    await truncateReports()
    await truncateDomain()
  })

  async function seedConnectedProject() {
    const ownerId = await createUser("owner@example.com", "admin")
    const pid = await seedProject({
      name: "g",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: ownerId,
    })
    await db.insert(githubIntegrations).values({
      projectId: pid,
      installationId: 10,
      repoOwner: "acme",
      repoName: "frontend",
      defaultLabels: ["feedback"],
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
          reporter: { email: "r@e.com" },
        },
      })
      .returning({ id: reports.id })
    return { pid, reportId: r?.id }
  }

  test("first reconcile creates issue + writes github columns", async () => {
    const { reportId } = await seedConnectedProject()
    const { client, calls } = makeMock()
    __setClientOverride(() => client)
    await reconcileReport(reportId)
    expect(calls.createIssue.length).toBe(1)
    const [row] = await db.select().from(reports).where(eq(reports.id, reportId))
    expect(row?.githubIssueNumber).toBe(42)
  })

  test("reconcile closes issue when status=resolved", async () => {
    const { reportId } = await seedConnectedProject()
    await db
      .update(reports)
      .set({
        status: "resolved",
        githubIssueNumber: 42,
        githubIssueNodeId: "NODE_42",
        githubIssueUrl: "https://github.com/acme/frontend/issues/42",
      })
      .where(eq(reports.id, reportId))
    const { client, calls } = makeMock()
    __setClientOverride(() => client)
    await reconcileReport(reportId)
    expect(calls.closeIssue.length).toBe(1)
    expect(calls.closeIssue[0]?.reason).toBe("completed")
  })

  test("reconcile updates labels when priority changes", async () => {
    const { reportId } = await seedConnectedProject()
    await db
      .update(reports)
      .set({
        priority: "urgent",
        githubIssueNumber: 42,
        githubIssueNodeId: "NODE_42",
        githubIssueUrl: "https://github.com/acme/frontend/issues/42",
      })
      .where(eq(reports.id, reportId))
    const { client, calls } = makeMock({
      getIssue: async () => ({ state: "open", labels: ["priority:normal"] }),
    })
    __setClientOverride(() => client)
    await reconcileReport(reportId)
    expect(calls.updateIssueLabels.length).toBe(1)
    const newLabels = calls.updateIssueLabels[0]?.labels as string[]
    expect(newLabels).toContain("priority:urgent")
    expect(newLabels).not.toContain("priority:normal")
  })

  test("reconcile echo-suppresses when remote already matches", async () => {
    const { reportId } = await seedConnectedProject()
    await db
      .update(reports)
      .set({
        priority: "normal",
        status: "open",
        githubIssueNumber: 42,
        githubIssueNodeId: "NODE_42",
        githubIssueUrl: "https://github.com/acme/frontend/issues/42",
      })
      .where(eq(reports.id, reportId))
    const { client, calls } = makeMock({
      getIssue: async () => ({ state: "open", labels: ["feedback", "priority:normal"] }),
    })
    __setClientOverride(() => client)
    await reconcileReport(reportId)
    expect(calls.closeIssue.length).toBe(0)
    expect(calls.reopenIssue.length).toBe(0)
    expect(calls.updateIssueLabels.length).toBe(0)
  })
})

describe("webhook", () => {
  afterEach(async () => {
    await truncateGithub()
    await truncateReports()
    await truncateDomain()
  })

  test("invalid signature → 401", async () => {
    const body = JSON.stringify({ action: "closed" })
    const res = await fetch(`${BASE_URL}/api/integrations/github/webhook`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-hub-signature-256": "sha256=bad" },
      body,
    })
    expect(res.status).toBe(401)
  })

  test("issues.closed updates dashboard + inserts event", async () => {
    const ownerId = await createUser("owner@example.com", "admin")
    const pid = await seedProject({
      name: "g",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: ownerId,
    })
    await db.insert(githubIntegrations).values({
      projectId: pid,
      installationId: 10,
      repoOwner: "acme",
      repoName: "frontend",
    })
    const [r] = await db
      .insert(reports)
      .values({
        projectId: pid,
        title: "Crash",
        description: "x",
        context: {
          pageUrl: "x",
          userAgent: "x",
          viewport: { w: 1, h: 1 },
          timestamp: new Date().toISOString(),
        },
        githubIssueNumber: 42,
        githubIssueNodeId: "NODE_42",
        githubIssueUrl: "https://github.com/acme/frontend/issues/42",
      })
      .returning({ id: reports.id })
    const body = JSON.stringify({
      action: "closed",
      issue: { number: 42, state: "closed", state_reason: "completed" },
      repository: { name: "frontend", owner: { login: "acme" } },
    })
    const res = await fetch(`${BASE_URL}/api/integrations/github/webhook`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-github-event": "issues",
        "x-github-delivery": crypto.randomUUID(),
        "x-hub-signature-256": sign(
          process.env.GITHUB_APP_WEBHOOK_SECRET ?? "test-webhook-secret",
          body,
        ),
      },
      body,
    })
    expect(res.status).toBe(202)
    const [updated] = await db.select().from(reports).where(eq(reports.id, r?.id))
    expect(updated?.status).toBe("resolved")
    const evs = await db.select().from(reportEvents).where(eq(reportEvents.reportId, r?.id))
    expect(evs.length).toBe(1)
    expect(evs[0]?.kind).toBe("status_changed")
    expect(evs[0]?.actorId).toBeNull()
  })

  test("installation.deleted flips all matching integrations", async () => {
    const ownerId = await createUser("owner@example.com", "admin")
    const pid = await seedProject({
      name: "g",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: ownerId,
    })
    await db.insert(githubIntegrations).values({
      projectId: pid,
      installationId: 555,
      repoOwner: "acme",
      repoName: "frontend",
    })
    const body = JSON.stringify({ action: "deleted", installation: { id: 555 } })
    const res = await fetch(`${BASE_URL}/api/integrations/github/webhook`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-github-event": "installation",
        "x-github-delivery": crypto.randomUUID(),
        "x-hub-signature-256": sign(
          process.env.GITHUB_APP_WEBHOOK_SECRET ?? "test-webhook-secret",
          body,
        ),
      },
      body,
    })
    expect(res.status).toBe(202)
    const [row] = await db
      .select()
      .from(githubIntegrations)
      .where(eq(githubIntegrations.projectId, pid))
    expect(row?.status).toBe("disconnected")
  })
})

describe("manual sync + unlink + enqueue hooks", () => {
  afterEach(async () => {
    await truncateGithub()
    await truncateReports()
    await truncateDomain()
  })

  test("POST /github-sync enqueues a job", async () => {
    const ownerId = await createUser("owner@example.com", "admin")
    const pid = await seedProject({
      name: "g",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: ownerId,
    })
    await db
      .insert(githubIntegrations)
      .values({ projectId: pid, installationId: 10, repoOwner: "acme", repoName: "frontend" })
    const [r] = await db
      .insert(reports)
      .values({
        projectId: pid,
        title: "x",
        description: "x",
        context: {
          pageUrl: "x",
          userAgent: "x",
          viewport: { w: 1, h: 1 },
          timestamp: new Date().toISOString(),
        },
      })
      .returning({ id: reports.id })
    const cookie = await signIn("owner@example.com")
    const { status } = await apiFetch(`/api/projects/${pid}/reports/${r?.id}/github-sync`, {
      method: "POST",
      headers: { cookie },
    })
    expect(status).toBe(200)
    // The in-process trigger runs reconcile against the facade mock here;
    // wait for it to settle back to pending (mock's getIssue returns a state
    // that matches — no writes happen, job row stays pending on backoff).
    await waitForSyncTriggerSettle()
    const jobs = await db.select().from(reportSyncJobs).where(eq(reportSyncJobs.reportId, r?.id))
    expect(jobs.length).toBe(1)
    expect(jobs[0]?.state).toBe("pending")
  })

  test("POST /github-sync is idempotent (second call doesn't duplicate)", async () => {
    const ownerId = await createUser("owner@example.com", "admin")
    const pid = await seedProject({
      name: "g",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: ownerId,
    })
    await db
      .insert(githubIntegrations)
      .values({ projectId: pid, installationId: 10, repoOwner: "acme", repoName: "frontend" })
    const [r] = await db
      .insert(reports)
      .values({
        projectId: pid,
        title: "x",
        description: "x",
        context: {
          pageUrl: "x",
          userAgent: "x",
          viewport: { w: 1, h: 1 },
          timestamp: new Date().toISOString(),
        },
      })
      .returning({ id: reports.id })
    const cookie = await signIn("owner@example.com")
    await apiFetch(`/api/projects/${pid}/reports/${r?.id}/github-sync`, {
      method: "POST",
      headers: { cookie },
    })
    await apiFetch(`/api/projects/${pid}/reports/${r?.id}/github-sync`, {
      method: "POST",
      headers: { cookie },
    })
    const jobs = await db.select().from(reportSyncJobs).where(eq(reportSyncJobs.reportId, r?.id))
    expect(jobs.length).toBe(1)
  })

  test("POST /github-unlink clears columns + deletes pending job + inserts event", async () => {
    const ownerId = await createUser("owner@example.com", "admin")
    const pid = await seedProject({
      name: "g",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: ownerId,
    })
    const [r] = await db
      .insert(reports)
      .values({
        projectId: pid,
        title: "x",
        description: "x",
        context: {
          pageUrl: "x",
          userAgent: "x",
          viewport: { w: 1, h: 1 },
          timestamp: new Date().toISOString(),
        },
        githubIssueNumber: 7,
        githubIssueNodeId: "NODE_7",
        githubIssueUrl: "https://github.com/acme/frontend/issues/7",
      })
      .returning({ id: reports.id })
    await db.insert(reportSyncJobs).values({ reportId: r?.id })
    const cookie = await signIn("owner@example.com")
    const { status } = await apiFetch(`/api/projects/${pid}/reports/${r?.id}/github-unlink`, {
      method: "POST",
      headers: { cookie },
    })
    expect(status).toBe(200)
    const [row] = await db.select().from(reports).where(eq(reports.id, r?.id))
    expect(row?.githubIssueNumber).toBeNull()
    const jobs = await db.select().from(reportSyncJobs).where(eq(reportSyncJobs.reportId, r?.id))
    expect(jobs.length).toBe(0)
    const evs = await db.select().from(reportEvents).where(eq(reportEvents.reportId, r?.id))
    expect(evs.find((e) => e.kind === "github_unlinked")).toBeDefined()
  })

  test("intake with connected integration and autoCreateOnIntake=true enqueues a sync job", async () => {
    const ownerId = await createUser("owner@example.com", "admin")
    const pid = await seedProject({
      name: "g",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: ownerId,
    })
    await db.insert(githubIntegrations).values({
      projectId: pid,
      installationId: 10,
      repoOwner: "acme",
      repoName: "frontend",
      autoCreateOnIntake: true,
    })
    const fd = new FormData()
    fd.set(
      "report",
      new Blob(
        [
          JSON.stringify({
            projectKey: PK,
            title: "from intake",
            description: "x",
            context: {
              pageUrl: "http://localhost:4000/p",
              userAgent: "UA",
              viewport: { w: 1, h: 1 },
              timestamp: new Date().toISOString(),
            },
            _dwellMs: 2000,
          }),
        ],
        { type: "application/json" },
      ),
    )
    const res = await fetch(`${BASE_URL}/api/intake/reports`, {
      method: "POST",
      headers: { Origin: ORIGIN },
      body: fd,
    })
    expect(res.status).toBe(201)
    const { id } = (await res.json()) as { id: string }
    const jobs = await db.select().from(reportSyncJobs).where(eq(reportSyncJobs.reportId, id))
    expect(jobs.length).toBe(1)
  })

  test("viewer forbidden on github-sync, github-unlink, retry-failed", async () => {
    const ownerId = await createUser("owner@example.com", "admin")
    const viewer = await createUser("viewer@example.com", "member")
    const pid = await seedProject({
      name: "g",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: ownerId,
    })
    await db.insert(projectMembers).values({ projectId: pid, userId: viewer, role: "viewer" })
    const [r] = await db
      .insert(reports)
      .values({
        projectId: pid,
        title: "x",
        description: "x",
        context: {
          pageUrl: "x",
          userAgent: "x",
          viewport: { w: 1, h: 1 },
          timestamp: new Date().toISOString(),
        },
      })
      .returning({ id: reports.id })
    const cookie = await signIn("viewer@example.com")
    const r1 = await apiFetch(`/api/projects/${pid}/reports/${r?.id}/github-sync`, {
      method: "POST",
      headers: { cookie },
    })
    expect(r1.status).toBe(403)
    const r2 = await apiFetch(`/api/projects/${pid}/reports/${r?.id}/github-unlink`, {
      method: "POST",
      headers: { cookie },
    })
    expect(r2.status).toBe(403)
    const r3 = await apiFetch(`/api/projects/${pid}/integrations/github/retry-failed`, {
      method: "POST",
      headers: { cookie },
    })
    expect(r3.status).toBe(403)
  })
})
