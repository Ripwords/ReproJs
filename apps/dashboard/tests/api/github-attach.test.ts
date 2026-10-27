// apps/dashboard/tests/api/github-attach.test.ts
//
// Attaching reports to an EXISTING GitHub issue. Covers the whole path:
// widget hint on intake → manager attaches → reconcile posts the report body
// once as a comment and otherwise only follows the issue → webhooks fan out
// to every report on the issue → unlink clears the link.
//
// GitHub is mocked in-process via __setClientOverride (reconcile and the
// attach helper run in this process against the shared Postgres); the HTTP
// layer (intake, guards, webhooks, unlink) runs against the dev server.
import { setup } from "../nuxt-setup"
import { setDefaultTimeout } from "bun:test"
setDefaultTimeout(60000)
import { afterEach, beforeAll, describe, expect, test } from "bun:test"
import { createHmac } from "node:crypto"
import { and, eq, sql } from "drizzle-orm"
import type { GitHubInstallationClient, IssueSummary } from "@reprojs/integrations-github"
import type { Octokit } from "@octokit/rest"
import { db } from "../../server/db"
import {
  githubIntegrations,
  githubWriteLocks,
  projectMembers,
  reportComments,
  reportEvents,
  reports,
  reportSyncJobs,
} from "../../server/db/schema"
import { __setClientOverride } from "../../server/lib/github"
import { attachReportToGithubIssue } from "../../server/lib/github-attach"
import { linkReportToGithubIssue } from "../../server/lib/github-link"
import { signCommentUpsert } from "../../server/lib/github-diff"
import { reportMarker } from "../../server/lib/github-helpers"
import { reconcileReport, type LiveIssue } from "../../server/lib/github-reconcile"
import {
  apiFetch,
  createUser,
  makePngBlob,
  seedGithubApp,
  seedProject,
  signIn,
  truncateDomain,
  truncateGithub,
  truncateGithubApp,
  truncateReports,
  waitForSyncTriggerSettle,
} from "../helpers"

await setup({ server: true, port: 3000, host: "localhost" })

const BASE_URL = process.env.TEST_BASE_URL ?? "http://localhost:3000"
const PK = "rp_pk_ATTACH1234567890abcdef12"
const ORIGIN = "http://localhost:4000"
const INSTALLATION_ID = 77
const WEBHOOK_SECRET = "test-webhook-secret"

// --- GitHub mock -----------------------------------------------------------

interface MockCalls {
  createComment: Array<{ issue_number: number; body: string }>
  setLabels: Array<Record<string, unknown>>
  update: Array<Record<string, unknown>>
  addAssignees: Array<Record<string, unknown>>
  removeAssignees: Array<Record<string, unknown>>
}

const EXISTING_ISSUE: IssueSummary = {
  number: 42,
  nodeId: "I_kwDOexisting42",
  title: "Checkout button unresponsive on Safari",
  state: "open",
  url: "https://github.com/acme/frontend/issues/42",
  labels: ["bug", "priority: high"],
  updatedAt: "2026-10-20T10:00:00Z",
}

// Live issue deliberately differs from every report field (title, labels,
// state, assignees, milestone) so a `created`-style reconcile WOULD push.
const LIVE_ISSUE: LiveIssue = {
  title: EXISTING_ISSUE.title,
  state: "open",
  stateReason: null,
  labels: ["bug", "priority: high"],
  assigneeLogins: ["octocat"],
  milestoneNumber: 7,
}

interface MockOptions {
  /** Replaces the default createIssue (which throws): lets a test run work mid-call. */
  createIssue?: GitHubInstallationClient["createIssue"]
  /** Comments already on the issue, returned by octokit.paginate(listComments). */
  existingComments?: Array<{ id: number; body: string }>
}

function makeMock(opts: MockOptions = {}): { client: GitHubInstallationClient; calls: MockCalls } {
  const calls: MockCalls = {
    createComment: [],
    setLabels: [],
    update: [],
    addAssignees: [],
    removeAssignees: [],
  }
  let nextCommentId = 9001
  const existing = (opts.existingComments ?? []).map((c) => ({
    id: c.id,
    body: c.body,
    user: { id: 1, login: "repro[bot]", avatar_url: null },
    created_at: "2026-10-21T10:00:00Z",
    updated_at: "2026-10-21T10:00:00Z",
  }))
  const octokit = {
    paginate: {
      iterator: () =>
        (async function* () {
          yield { data: existing }
        })(),
    },
    rest: {
      issues: {
        get: async () => ({ data: {} as never }),
        createComment: async (args: { issue_number: number; body: string }) => {
          calls.createComment.push(args)
          const id = nextCommentId++
          return {
            data: {
              id,
              body: args.body,
              user: { id: 1, login: "repro[bot]", avatar_url: null },
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          }
        },
        setLabels: async (args: Record<string, unknown>) => {
          calls.setLabels.push(args)
        },
        update: async (args: Record<string, unknown>) => {
          calls.update.push(args)
        },
        addAssignees: async (args: Record<string, unknown>) => {
          calls.addAssignees.push(args)
          return { data: { assignees: [] } }
        },
        removeAssignees: async (args: Record<string, unknown>) => {
          calls.removeAssignees.push(args)
          return { data: { assignees: [] } }
        },
        checkUserCanBeAssigned: async () => ({ status: 204 }),
      },
    },
  } as unknown as Octokit

  const client = {
    createIssue:
      opts.createIssue ??
      (async () => {
        throw new Error("createIssue must not be called for attached reports")
      }),
    getIssue: async () => ({ state: "open" as const, labels: LIVE_ISSUE.labels }),
    closeIssue: async () => {},
    reopenIssue: async () => {},
    updateIssueLabels: async () => {},
    listInstallationRepositories: async () => [],
    findIssueByMarker: async () => null,
    listRepoLabels: async () => [],
    listAssignableUsers: async () => [],
    listMilestones: async () => [],
    createLabel: async () => ({ name: "x", color: "ccc", description: null }),
    getIssueSummary: async (_owner: string, _repo: string, n: number) =>
      n === EXISTING_ISSUE.number ? EXISTING_ISSUE : null,
    listIssues: async () => [EXISTING_ISSUE],
    getRichIssue: async () => LIVE_ISSUE,
    getRawOctokit: () => octokit,
  }
  return { client: client as unknown as GitHubInstallationClient, calls }
}

// --- Seeding helpers -------------------------------------------------------

function reportJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    projectKey: PK,
    title: "Checkout button does nothing (re-test)",
    description: "Still broken after the fix in release 1.2",
    context: {
      pageUrl: "http://localhost:4000/checkout",
      userAgent: "Mozilla/5.0 Safari Test",
      viewport: { w: 1440, h: 900 },
      timestamp: new Date().toISOString(),
    },
    _dwellMs: 2000,
    ...overrides,
  })
}

async function intake(json: string): Promise<string> {
  const fd = new FormData()
  fd.set("report", new Blob([json], { type: "application/json" }))
  fd.set("screenshot", makePngBlob(), "screenshot.png")
  const res = await fetch(`${BASE_URL}/api/intake/reports`, {
    method: "POST",
    headers: { Origin: ORIGIN },
    body: fd,
  })
  expect(res.status).toBe(201)
  const { id } = (await res.json()) as { id: string }
  return id
}

async function seedConnectedProject(opts: { autoCreateOnIntake?: boolean } = {}) {
  const ownerId = await createUser("owner-attach@example.com", "member")
  const pid = await seedProject({
    name: "attach-test",
    publicKey: PK,
    allowedOrigins: [ORIGIN],
    createdBy: ownerId,
  })
  await db.insert(projectMembers).values({ projectId: pid, userId: ownerId, role: "owner" })
  await db.insert(githubIntegrations).values({
    projectId: pid,
    installationId: INSTALLATION_ID,
    repoOwner: "acme",
    repoName: "frontend",
    status: "connected",
    autoCreateOnIntake: opts.autoCreateOnIntake ?? true,
  })
  return { pid, ownerId }
}

async function loadReport(id: string) {
  const [row] = await db.select().from(reports).where(eq(reports.id, id)).limit(1)
  if (!row) throw new Error(`report ${id} missing`)
  return row
}

function sign(payload: string): string {
  return `sha256=${createHmac("sha256", WEBHOOK_SECRET).update(payload).digest("hex")}`
}

async function sendWebhook(eventName: string, body: unknown) {
  const raw = JSON.stringify(body)
  return fetch(`${BASE_URL}/api/integrations/github/webhook`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-github-event": eventName,
      "x-github-delivery": crypto.randomUUID(),
      "x-hub-signature-256": sign(raw),
    },
    body: raw,
  })
}

const REPO = { name: "frontend", owner: { login: "acme" } }

beforeAll(async () => {
  process.env.ATTACHMENT_URL_SECRET = process.env.ATTACHMENT_URL_SECRET ?? "test-attachment-secret"
  await truncateGithubApp()
  await seedGithubApp()
})

afterEach(async () => {
  __setClientOverride(null)
  await db.execute(sql`TRUNCATE github_write_locks RESTART IDENTITY CASCADE`)
  await truncateGithub()
  await truncateReports()
  await truncateDomain()
})

// --- Tests -----------------------------------------------------------------

describe("intake — relatedIssue hint", () => {
  test("stores the parsed number as a hint and skips auto-create even when the toggle is on", async () => {
    await seedConnectedProject({ autoCreateOnIntake: true })

    const hinted = await intake(
      reportJson({ relatedIssue: "https://github.com/acme/frontend/issues/42" }),
    )
    const plain = await intake(reportJson({ title: "Unrelated new bug" }))
    await waitForSyncTriggerSettle()

    const hintedRow = await loadReport(hinted)
    expect(hintedRow.reporterIssueHint).toBe(42)
    expect(hintedRow.githubIssueNumber).toBeNull()
    expect(hintedRow.githubLinkKind).toBeNull()
    const hintedJobs = await db
      .select()
      .from(reportSyncJobs)
      .where(eq(reportSyncJobs.reportId, hinted))
    expect(hintedJobs.length).toBe(0)

    // Control: the same intake without a hint still auto-creates.
    const plainJobs = await db
      .select()
      .from(reportSyncJobs)
      .where(eq(reportSyncJobs.reportId, plain))
    expect(plainJobs.length).toBe(1)
  })

  test("garbage in the field is dropped silently and the response is identical", async () => {
    await seedConnectedProject({ autoCreateOnIntake: false })
    const id = await intake(reportJson({ relatedIssue: "not an issue at all" }))
    const row = await loadReport(id)
    expect(row.reporterIssueHint).toBeNull()
  })
})

describe("POST /api/projects/:id/reports/:reportId/github-link — guards", () => {
  test("401 without a session, 403 for viewers, 400 for a bad body, 404 for a foreign report", async () => {
    const { pid } = await seedConnectedProject()
    const reportId = await intake(reportJson({ relatedIssue: "#42" }))

    const anon = await apiFetch(`/api/projects/${pid}/reports/${reportId}/github-link`, {
      method: "POST",
      body: { issueNumber: 42 },
    })
    expect(anon.status).toBe(401)

    const viewerId = await createUser("viewer-attach@example.com", "member")
    await db.insert(projectMembers).values({ projectId: pid, userId: viewerId, role: "viewer" })
    const viewerCookie = await signIn("viewer-attach@example.com")
    const viewer = await apiFetch(`/api/projects/${pid}/reports/${reportId}/github-link`, {
      method: "POST",
      headers: { cookie: viewerCookie },
      body: { issueNumber: 42 },
    })
    expect(viewer.status).toBe(403)

    const ownerCookie = await signIn("owner-attach@example.com")
    const bad = await apiFetch(`/api/projects/${pid}/reports/${reportId}/github-link`, {
      method: "POST",
      headers: { cookie: ownerCookie },
      body: { issueNumber: "42" },
    })
    expect(bad.status).toBe(400)

    // A report that belongs to another project must not be reachable.
    const otherOwner = await createUser("other-owner@example.com", "member")
    const otherPid = await seedProject({
      name: "other",
      publicKey: "rp_pk_OTHER1234567890abcdef123",
      createdBy: otherOwner,
    })
    const [foreign] = await db
      .insert(reports)
      .values({ projectId: otherPid, title: "foreign", context: {} })
      .returning({ id: reports.id })
    const foreignRes = await apiFetch(`/api/projects/${pid}/reports/${foreign?.id}/github-link`, {
      method: "POST",
      headers: { cookie: ownerCookie },
      body: { issueNumber: 42 },
    })
    expect(foreignRes.status).toBe(404)

    // Nothing above may have touched the report.
    const row = await loadReport(reportId)
    expect(row.githubIssueNumber).toBeNull()
    expect(row.reporterIssueHint).toBe(42)
  })

  test("409 when the integration is disconnected", async () => {
    const { pid } = await seedConnectedProject()
    const reportId = await intake(reportJson())
    await db
      .update(githubIntegrations)
      .set({ status: "disconnected" })
      .where(eq(githubIntegrations.projectId, pid))
    const cookie = await signIn("owner-attach@example.com")
    const res = await apiFetch(`/api/projects/${pid}/reports/${reportId}/github-link`, {
      method: "POST",
      headers: { cookie },
      body: { issueNumber: 42 },
    })
    expect(res.status).toBe(409)
  })

  test("GET issues endpoints require manager+ and a connected repo", async () => {
    const { pid } = await seedConnectedProject()
    const viewerId = await createUser("viewer-list@example.com", "member")
    await db.insert(projectMembers).values({ projectId: pid, userId: viewerId, role: "viewer" })
    const viewerCookie = await signIn("viewer-list@example.com")
    const list = await apiFetch(`/api/projects/${pid}/integrations/github/issues?q=checkout`, {
      headers: { cookie: viewerCookie },
    })
    expect(list.status).toBe(403)
    const one = await apiFetch(`/api/projects/${pid}/integrations/github/issues/42`, {
      headers: { cookie: viewerCookie },
    })
    expect(one.status).toBe(403)

    const ownerCookie = await signIn("owner-attach@example.com")
    const badNumber = await apiFetch(`/api/projects/${pid}/integrations/github/issues/abc`, {
      headers: { cookie: ownerCookie },
    })
    expect(badNumber.status).toBe(400)

    await db
      .update(githubIntegrations)
      .set({ repoOwner: "", repoName: "" })
      .where(eq(githubIntegrations.projectId, pid))
    const noRepo = await apiFetch(`/api/projects/${pid}/integrations/github/issues`, {
      headers: { cookie: ownerCookie },
    })
    expect(noRepo.status).toBe(409)
  })
})

describe("attach → reconcile follows the issue", () => {
  test("unknown issue → 404 and nothing stored", async () => {
    const { pid, ownerId } = await seedConnectedProject()
    const reportId = await intake(reportJson({ relatedIssue: "#999" }))
    const { client, calls } = makeMock()
    __setClientOverride(() => client)

    const err = await attachReportToGithubIssue({
      projectId: pid,
      reportId,
      actorId: ownerId,
      actorClientId: null,
      issueNumber: 999,
    }).then(
      () => null,
      (e: unknown) => e as { statusCode?: number; statusMessage?: string },
    )
    expect(err?.statusCode).toBe(404)
    expect(err?.statusMessage).toBe("Issue not found")

    const row = await loadReport(reportId)
    expect(row.githubIssueNumber).toBeNull()
    expect(row.githubLinkKind).toBeNull()
    expect(row.reporterIssueHint).toBe(999)
    const events = await db.select().from(reportEvents).where(eq(reportEvents.reportId, reportId))
    expect(events.filter((e) => e.kind === "github_linked").length).toBe(0)
    expect(calls.createComment.length).toBe(0)
  })

  test("known issue → attached, one body comment with marker + screenshot, retry posts nothing, zero pushes", async () => {
    const { pid, ownerId } = await seedConnectedProject()
    const reportId = await intake(reportJson({ relatedIssue: "#42" }))
    const { client, calls } = makeMock()
    __setClientOverride(() => client)

    const result = await attachReportToGithubIssue({
      projectId: pid,
      reportId,
      actorId: ownerId,
      actorClientId: null,
      issueNumber: 42,
    })
    expect(result).toEqual({
      issueNumber: 42,
      issueUrl: EXISTING_ISSUE.url,
      alreadyLinked: false,
    })

    let row = await loadReport(reportId)
    expect(row.githubIssueNumber).toBe(42)
    expect(row.githubIssueNodeId).toBe(EXISTING_ISSUE.nodeId)
    expect(row.githubIssueUrl).toBe(EXISTING_ISSUE.url)
    expect(row.githubLinkKind).toBe("attached")
    expect(row.reporterIssueHint).toBeNull()

    const [linkedEvent] = await db
      .select()
      .from(reportEvents)
      .where(and(eq(reportEvents.reportId, reportId), eq(reportEvents.kind, "github_linked")))
    expect(linkedEvent?.payload).toMatchObject({
      number: 42,
      kind: "attached",
      title: EXISTING_ISSUE.title,
    })

    // The attach enqueued a reconcile; the in-process trigger may already
    // have run it. Run it again explicitly — the second pass is the retry.
    await waitForSyncTriggerSettle()
    await reconcileReport(reportId)
    await reconcileReport(reportId)

    expect(calls.createComment.length).toBe(1)
    const posted = calls.createComment[0]
    expect(posted?.issue_number).toBe(42)
    expect(posted?.body).toContain(reportMarker(reportId))
    expect(posted?.body).toContain("kind=screenshot")
    expect(posted?.body).toContain("Checkout button does nothing (re-test)")

    row = await loadReport(reportId)
    expect(row.githubAttachCommentId).toBe(9001)
    expect(row.githubSyncedAt).not.toBeNull()

    // Echo protection: the write-lock for the posted comment exists.
    const locks = await db
      .select()
      .from(githubWriteLocks)
      .where(eq(githubWriteLocks.reportId, reportId))
    expect(locks.map((l) => l.signature)).toContain(signCommentUpsert(9001, posted?.body ?? ""))

    // Follow-only: the live issue differs from the report in every field and
    // still nothing was pushed.
    expect(calls.setLabels.length).toBe(0)
    expect(calls.update.length).toBe(0)
    expect(calls.addAssignees.length).toBe(0)
    expect(calls.removeAssignees.length).toBe(0)
    expect(row.title).toBe("Checkout button does nothing (re-test)")

    // Attaching the same issue again is a no-op, a different one is refused.
    const again = await attachReportToGithubIssue({
      projectId: pid,
      reportId,
      actorId: ownerId,
      actorClientId: null,
      issueNumber: 42,
    })
    expect(again.alreadyLinked).toBe(true)
  })

  test("two reports on one issue: webhooks fan out, comments mirror to exactly one, unlink clears", async () => {
    const { pid, ownerId } = await seedConnectedProject({ autoCreateOnIntake: false })
    const first = await intake(reportJson({ title: "First re-test", relatedIssue: "#42" }))
    const second = await intake(reportJson({ title: "Second re-test", relatedIssue: "#42" }))
    const { client, calls } = makeMock()
    __setClientOverride(() => client)

    for (const reportId of [first, second]) {
      await attachReportToGithubIssue({
        projectId: pid,
        reportId,
        actorId: ownerId,
        actorClientId: null,
        issueNumber: 42,
      })
    }
    await waitForSyncTriggerSettle()
    await reconcileReport(first)
    await reconcileReport(second)
    expect(calls.createComment.length).toBe(2)
    expect((await loadReport(first)).githubAttachCommentId).toBe(9001)
    expect((await loadReport(second)).githubAttachCommentId).toBe(9002)

    // GitHub echoes our own body comment back: dropped, no mirrored row.
    const echo = await sendWebhook("issue_comment", {
      action: "created",
      comment: {
        id: 9001,
        body: calls.createComment[0]?.body,
        user: { id: 1, login: "repro[bot]", avatar_url: "https://example.com/a.png" },
      },
      issue: { number: 42 },
      repository: REPO,
      installation: { id: INSTALLATION_ID },
    })
    expect(echo.status).toBe(202)
    expect((await echo.json()) as { echo?: boolean }).toMatchObject({ echo: true })

    // A human comment on the issue mirrors to ONE report: the oldest attached.
    const human = await sendWebhook("issue_comment", {
      action: "created",
      comment: {
        id: 7777,
        body: "Can you both retry on 1.2.1?",
        user: { id: 500, login: "maintainer", avatar_url: "https://example.com/m.png" },
      },
      issue: { number: 42 },
      repository: REPO,
      installation: { id: INSTALLATION_ID },
    })
    expect(human.status).toBe(202)
    const mirrored = await db
      .select()
      .from(reportComments)
      .where(eq(reportComments.githubCommentId, 7777))
    expect(mirrored.length).toBe(1)
    expect(mirrored[0]?.reportId).toBe(first)
    expect(mirrored[0]?.body).toBe("Can you both retry on 1.2.1?")

    // Closing the issue resolves BOTH reports.
    const closed = await sendWebhook("issues", {
      action: "closed",
      issue: { number: 42, title: EXISTING_ISSUE.title, state: "closed", labels: [] },
      repository: REPO,
      installation: { id: INSTALLATION_ID },
    })
    expect(closed.status).toBe(202)
    expect((await loadReport(first)).status).toBe("resolved")
    expect((await loadReport(second)).status).toBe("resolved")

    // Title edits follow too, on every report.
    const edited = await sendWebhook("issues", {
      action: "edited",
      changes: { title: { from: EXISTING_ISSUE.title } },
      issue: { number: 42, title: "Checkout dead on Safari 18", state: "closed", labels: [] },
      repository: REPO,
      installation: { id: INSTALLATION_ID },
    })
    expect(edited.status).toBe(202)
    expect((await loadReport(first)).title).toBe("Checkout dead on Safari 18")
    expect((await loadReport(second)).title).toBe("Checkout dead on Safari 18")

    // Unlink one report through the dashboard: link kind + comment id cleared,
    // the other report stays attached.
    const cookie = await signIn("owner-attach@example.com")
    const unlink = await apiFetch(`/api/projects/${pid}/reports/${second}/github-unlink`, {
      method: "POST",
      headers: { cookie },
    })
    expect(unlink.status).toBe(200)
    const secondRow = await loadReport(second)
    expect(secondRow.githubIssueNumber).toBeNull()
    expect(secondRow.githubLinkKind).toBeNull()
    expect(secondRow.githubAttachCommentId).toBeNull()
    const firstRow = await loadReport(first)
    expect(firstRow.githubLinkKind).toBe("attached")
    expect(firstRow.githubAttachCommentId).toBe(9001)

    // The REST detail exposes the new fields for the UI.
    const detail = await apiFetch<{
      githubLinkKind: string | null
      reporterIssueHint: number | null
    }>(`/api/projects/${pid}/reports/${first}`, { headers: { cookie } })
    expect(detail.status).toBe(200)
    expect(detail.body.githubLinkKind).toBe("attached")
    expect(detail.body.reporterIssueHint).toBeNull()
  })
})

describe("attach comment echo", () => {
  /** Link without the post-commit enqueue so no reconcile runs behind the test's back. */
  async function linkOnly(pid: string, ownerId: string, reportId: string) {
    await db.transaction((tx) =>
      linkReportToGithubIssue(tx, {
        projectId: pid,
        reportId,
        actorId: ownerId,
        actorClientId: null,
        repoOwner: "acme",
        repoName: "frontend",
        issueNumber: EXISTING_ISSUE.number,
        issueNodeId: EXISTING_ISSUE.nodeId,
        issueTitle: EXISTING_ISSUE.title,
      }),
    )
  }

  test("an echo that beats the write-lock is dropped and its id adopted as the attach comment", async () => {
    const { pid, ownerId } = await seedConnectedProject({ autoCreateOnIntake: false })
    const reportId = await intake(reportJson({ relatedIssue: "#42" }))
    await linkOnly(pid, ownerId, reportId)
    const { client, calls } = makeMock()
    __setClientOverride(() => client)

    // GitHub delivers our own body comment before postAttachComment has
    // recorded the write-lock (createIssueComment has not even returned).
    const echoBody = `### Checkout button does nothing (re-test)\n\n${reportMarker(reportId)}\n\nbody`
    const echo = await sendWebhook("issue_comment", {
      action: "created",
      comment: {
        id: 9001,
        body: echoBody,
        user: { id: 1, login: "repro[bot]", avatar_url: "https://example.com/a.png" },
      },
      issue: { number: 42 },
      repository: REPO,
      installation: { id: INSTALLATION_ID },
    })
    expect(echo.status).toBe(202)
    expect((await echo.json()) as { echo?: boolean }).toMatchObject({ echo: true })

    const mirrored = await db
      .select()
      .from(reportComments)
      .where(eq(reportComments.reportId, reportId))
    expect(mirrored.length).toBe(0)
    const events = await db.select().from(reportEvents).where(eq(reportEvents.reportId, reportId))
    expect(events.filter((e) => e.kind === "comment_added").length).toBe(0)
    expect((await loadReport(reportId)).githubAttachCommentId).toBe(9001)

    // The reconciler now sees the id and posts nothing.
    await reconcileReport(reportId)
    expect(calls.createComment.length).toBe(0)
  })
})

describe("attach vs. auto-create race", () => {
  const CREATED = {
    number: 101,
    nodeId: "I_kwDOcreated101",
    url: "https://github.com/acme/frontend/issues/101",
  }

  test("a link that lands between createIssue and the reconciler's UPDATE survives; the reconciler does not overwrite it", async () => {
    await seedConnectedProject({ autoCreateOnIntake: false })
    const reportId = await intake(reportJson({ title: "Raced report" }))
    let createCalls = 0
    const { client } = makeMock({
      createIssue: async () => {
        createCalls++
        // A writer that does not hold the reconciler's advisory lock attaches
        // the report to #42 while GitHub is still answering createIssue.
        await db
          .update(reports)
          .set({
            githubIssueNumber: EXISTING_ISSUE.number,
            githubIssueNodeId: EXISTING_ISSUE.nodeId,
            githubIssueUrl: EXISTING_ISSUE.url,
            githubLinkKind: "attached",
          })
          .where(eq(reports.id, reportId))
        return CREATED
      },
    })
    __setClientOverride(() => client)

    await reconcileReport(reportId)

    expect(createCalls).toBe(1)
    const row = await loadReport(reportId)
    expect(row.githubIssueNumber).toBe(42)
    expect(row.githubIssueUrl).toBe(EXISTING_ISSUE.url)
    expect(row.githubLinkKind).toBe("attached")
  })

  test("attach waits for the reconciler's lock, then sees the created issue and is refused", async () => {
    const { pid, ownerId } = await seedConnectedProject({ autoCreateOnIntake: false })
    const reportId = await intake(reportJson({ title: "Locked report" }))
    let attachPromise: Promise<unknown> | null = null
    let rowDuringCreate: Awaited<ReturnType<typeof loadReport>> | null = null
    const { client } = makeMock({
      createIssue: async () => {
        attachPromise = attachReportToGithubIssue({
          projectId: pid,
          reportId,
          actorId: ownerId,
          actorClientId: null,
          issueNumber: 42,
        }).then(
          () => null,
          (e: unknown) => e as { statusCode?: number; statusMessage?: string },
        )
        // Give the attach time to reach its transaction: it must block on
        // the per-report lock the reconciler holds, not write.
        await new Promise((r) => setTimeout(r, 300))
        rowDuringCreate = await loadReport(reportId)
        return CREATED
      },
    })
    __setClientOverride(() => client)

    await reconcileReport(reportId)

    expect(rowDuringCreate?.githubIssueNumber).toBeNull()
    const row = await loadReport(reportId)
    expect(row.githubIssueNumber).toBe(CREATED.number)
    expect(row.githubLinkKind).toBe("created")

    const err = (await attachPromise) as { statusCode?: number; statusMessage?: string } | null
    expect(err?.statusCode).toBe(409)
    expect(err?.statusMessage).toContain("#101")
    const events = await db.select().from(reportEvents).where(eq(reportEvents.reportId, reportId))
    expect(events.filter((e) => e.kind === "github_linked").length).toBe(0)
  })
})
