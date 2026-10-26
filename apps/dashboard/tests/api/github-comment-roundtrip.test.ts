// apps/dashboard/tests/api/github-comment-roundtrip.test.ts
// Full roundtrip: dashboard comment POST → sync task reconcile → GitHub stub
// → write-lock recorded → inbound webhook echo-skip.
import { setup } from "../nuxt-setup"
import { setDefaultTimeout } from "bun:test"
setDefaultTimeout(60000)
import { afterEach, beforeAll, describe, expect, test } from "bun:test"
import { eq, sql } from "drizzle-orm"
import { createHmac } from "node:crypto"
import type { GitHubInstallationClient } from "@reprojs/integrations-github"
import type { Octokit } from "@octokit/rest"
import { __setClientOverride } from "../../server/lib/github"
import {
  reconcileCommentUpsertJob,
  reconcileCommentDeleteJob,
} from "../../server/lib/github-reconcile"
import { consumeWriteLock } from "../../server/lib/github-write-locks"
import { signCommentUpsert, signCommentDelete } from "../../server/lib/github-diff"
import { db } from "../../server/db"
import { githubIntegrations, projectMembers, reportComments, reports } from "../../server/db/schema"
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
} from "../helpers"

process.env.GITHUB_APP_ID = process.env.GITHUB_APP_ID || "12345"
process.env.GITHUB_APP_PRIVATE_KEY =
  process.env.GITHUB_APP_PRIVATE_KEY ||
  "-----BEGIN RSA PRIVATE KEY-----\ntest\n-----END RSA PRIVATE KEY-----"
process.env.GITHUB_APP_WEBHOOK_SECRET = "test-webhook-secret"

await setup({ server: true, port: 3000, host: "localhost" })

const BASE_URL = process.env.TEST_BASE_URL ?? "http://localhost:3000"

const PK = "rp_pk_COMMENTROUNDTRIP000000000"
const ORIGIN = "http://localhost:4000"
const SECRET = "test-webhook-secret"

function sign(secret: string, payload: string): string {
  const h = createHmac("sha256", secret)
  h.update(payload)
  return `sha256=${h.digest("hex")}`
}

async function sendWebhook(eventName: string, body: unknown) {
  const raw = JSON.stringify(body)
  return fetch(`${BASE_URL}/api/integrations/github/webhook`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-github-event": eventName,
      "x-github-delivery": crypto.randomUUID(),
      "x-hub-signature-256": sign(SECRET, raw),
    },
    body: raw,
  })
}

async function truncateWriteLocks() {
  await db.execute(sql`TRUNCATE github_write_locks RESTART IDENTITY CASCADE`)
}

interface MockOctokitCalls {
  createComment: Array<{ body: string; issue_number: number }>
  updateComment: Array<{ body: string; comment_id: number }>
  deleteComment: Array<{ comment_id: number }>
  listComments: number
}

function makeMockClient(): {
  client: GitHubInstallationClient
  calls: MockOctokitCalls
  setCreatedId: (id: number) => void
} {
  const calls: MockOctokitCalls = {
    createComment: [],
    updateComment: [],
    deleteComment: [],
    listComments: 0,
  }
  let nextCommentId = 8001

  const octokit = {
    paginate: {
      iterator: () => ({
        [Symbol.asyncIterator]: async function* () {
          calls.listComments++
          yield { data: [] }
        },
      }),
    },
    rest: {
      issues: {
        createComment: async (args: {
          owner: string
          repo: string
          issue_number: number
          body: string
        }) => {
          calls.createComment.push({ body: args.body, issue_number: args.issue_number })
          return {
            data: {
              id: nextCommentId,
              body: args.body,
              user: { id: 1, login: "bot", avatar_url: "" },
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          }
        },
        updateComment: async (args: {
          owner: string
          repo: string
          comment_id: number
          body: string
        }) => {
          calls.updateComment.push({ body: args.body, comment_id: args.comment_id })
          return { data: {} }
        },
        deleteComment: async (args: { owner: string; repo: string; comment_id: number }) => {
          calls.deleteComment.push({ comment_id: args.comment_id })
          return { data: {} }
        },
        listComments: async () => ({ data: [] }),
      },
    },
  } as unknown as Octokit

  const client = {
    createIssue: async () => ({
      number: 42,
      nodeId: "NODE_42",
      url: "https://github.com/acme/repo/issues/42",
    }),
    getIssue: async () => ({ state: "open", labels: [] }),
    closeIssue: async () => {},
    reopenIssue: async () => {},
    updateIssueLabels: async () => {},
    listInstallationRepositories: async () => [],
    findIssueByMarker: async () => null,
    getRichIssue: async () => ({
      title: "test",
      state: "open" as const,
      stateReason: null,
      labels: [],
      assigneeLogins: [],
      milestoneNumber: null,
    }),
    getRawOctokit: () => octokit,
  } as unknown as GitHubInstallationClient

  return {
    client,
    calls,
    setCreatedId: (id: number) => {
      nextCommentId = id
    },
  }
}

beforeAll(async () => {
  process.env.ATTACHMENT_URL_SECRET = process.env.ATTACHMENT_URL_SECRET ?? "test-attachment-secret"
  await truncateGithubApp()
  await seedGithubApp()
})

async function seedLinkedReport() {
  const ownerId = await createUser("owner-rt@example.com", "admin")
  const pid = await seedProject({
    name: "comment-roundtrip",
    publicKey: PK,
    allowedOrigins: [ORIGIN],
    createdBy: ownerId,
  })
  await db.insert(githubIntegrations).values({
    projectId: pid,
    installationId: 30,
    repoOwner: "acme",
    repoName: "frontend",
    status: "connected",
  })
  await db.insert(projectMembers).values({ projectId: pid, userId: ownerId, role: "owner" })

  const [report] = await db
    .insert(reports)
    .values({
      projectId: pid,
      title: "Roundtrip test",
      context: {},
      githubIssueNumber: 42,
    })
    .returning()
  if (!report) throw new Error("seedLinkedReport failed")

  const cookie = await signIn("owner-rt@example.com")
  return { pid, reportId: report.id, ownerId, cookie }
}

describe("comment roundtrip", () => {
  afterEach(async () => {
    __setClientOverride(null)
    await truncateWriteLocks()
    await truncateGithub()
    await truncateReports()
    await truncateDomain()
  })

  test("POST comment → reconcile → GitHub create → write-lock → echo skip", async () => {
    const { pid, reportId, cookie } = await seedLinkedReport()
    const { client, calls, setCreatedId } = makeMockClient()
    setCreatedId(9001)
    __setClientOverride(() => client)

    // 1. POST comment via dashboard API
    const postRes = await apiFetch(`/api/projects/${pid}/reports/${reportId}/comments`, {
      method: "POST",
      headers: { cookie },
      body: JSON.stringify({ body: "Roundtrip comment" }),
    })
    expect(postRes.status).toBe(201)

    // 2. Fetch the new comment id
    const [dbComment] = await db
      .select()
      .from(reportComments)
      .where(eq(reportComments.reportId, reportId))
    expect(dbComment).toBeDefined()
    const commentId = dbComment!.id

    // 3. Run the reconcile job (as the sync task would)
    await reconcileCommentUpsertJob(reportId, commentId)

    // 4. Verify GitHub createComment was called with bot footer
    expect(calls.createComment).toHaveLength(1)
    const sentBody = calls.createComment[0]!.body
    expect(sentBody).toContain("Roundtrip comment")
    expect(sentBody).toContain("via Repro dashboard")

    // 5. Verify the write-lock was recorded.
    // Use the exact body that was sent to GitHub (sentBody) to derive the signature,
    // since the author name varies based on the user record.
    const sig = signCommentUpsert(9001, sentBody)
    const locked = await consumeWriteLock(db, { reportId, kind: "comment_upsert", signature: sig })
    expect(locked).toBe(true)

    // 6. Update the DB row with the GitHub comment id (reconcile does this automatically)
    const [updated] = await db.select().from(reportComments).where(eq(reportComments.id, commentId))
    expect(updated?.githubCommentId).toBe(9001)

    // 7. Re-record the lock (consumed above) so the echo-skip webhook can consume it
    const { recordWriteLock } = await import("../../server/lib/github-write-locks")
    await recordWriteLock(db, {
      reportId,
      kind: "comment_upsert",
      signature: sig,
    })

    // 8. Simulate the GitHub echo webhook — should be echo-skipped
    const echoPayload = {
      action: "created",
      comment: {
        id: 9001,
        body: sentBody,
        user: { id: 1, login: "github-app[bot]", avatar_url: "https://example.com/bot.png" },
      },
      issue: { number: 42 },
      repository: { name: "frontend", owner: { login: "acme" } },
      installation: { id: 30 },
    }
    const webhookRes = await sendWebhook("issue_comment", echoPayload)
    expect(webhookRes.status).toBe(202)
    const webhookBody = (await webhookRes.json()) as { echo?: boolean }
    expect(webhookBody.echo).toBe(true)

    // 9. No duplicate comment row inserted (still exactly 1 row for this report)
    const allComments = await db
      .select()
      .from(reportComments)
      .where(eq(reportComments.reportId, reportId))
    expect(allComments).toHaveLength(1)
  })

  test("delete comment → reconcile → GitHub delete → write-lock → echo skip", async () => {
    const { reportId } = await seedLinkedReport()
    const { client, calls } = makeMockClient()
    __setClientOverride(() => client)

    // 1. Seed comment with a known githubCommentId
    const [dbComment] = await db
      .insert(reportComments)
      .values({
        reportId,
        body: "To be deleted",
        githubCommentId: 7001,
        source: "dashboard",
      })
      .returning()
    expect(dbComment).toBeDefined()
    const commentId = dbComment!.id

    // 2. Run the delete reconcile job
    await reconcileCommentDeleteJob(reportId, commentId, 7001)

    // 3. Verify GitHub deleteComment was called
    expect(calls.deleteComment).toHaveLength(1)
    expect(calls.deleteComment[0]!.comment_id).toBe(7001)

    // 4. Verify write-lock was recorded
    const sig = signCommentDelete(7001)
    const locked = await consumeWriteLock(db, { reportId, kind: "comment_delete", signature: sig })
    expect(locked).toBe(true)

    // 5. Re-record so the echo webhook can consume
    const { recordWriteLock } = await import("../../server/lib/github-write-locks")
    await recordWriteLock(db, {
      reportId,
      kind: "comment_delete",
      signature: sig,
    })

    // 6. Simulate the GitHub echo deletion webhook — should be echo-skipped
    const echoPayload = {
      action: "deleted",
      comment: {
        id: 7001,
        body: "",
        user: { id: 1, login: "github-app[bot]", avatar_url: "https://example.com/bot.png" },
      },
      issue: { number: 42 },
      repository: { name: "frontend", owner: { login: "acme" } },
      installation: { id: 30 },
    }
    const webhookRes = await sendWebhook("issue_comment", echoPayload)
    expect(webhookRes.status).toBe(202)
    const webhookBody = (await webhookRes.json()) as { echo?: boolean }
    expect(webhookBody.echo).toBe(true)

    // 7. DB row should NOT be soft-deleted (echo was skipped)
    const [row] = await db.select().from(reportComments).where(eq(reportComments.id, commentId))
    expect(row?.deletedAt).toBeNull()
  })

  test("inbound GitHub comment (not echo) is stored in DB", async () => {
    const { reportId } = await seedLinkedReport()

    // No write lock pre-recorded — this is a genuine external comment
    const externalPayload = {
      action: "created",
      comment: {
        id: 6001,
        body: "External reviewer comment",
        user: {
          id: 5555,
          login: "external-reviewer",
          avatar_url: "https://example.com/avatar.png",
        },
      },
      issue: { number: 42 },
      repository: { name: "frontend", owner: { login: "acme" } },
      installation: { id: 30 },
    }
    const webhookRes = await sendWebhook("issue_comment", externalPayload)
    expect(webhookRes.status).toBe(202)

    const [row] = await db
      .select()
      .from(reportComments)
      .where(eq(reportComments.githubCommentId, 6001))
    expect(row).toBeDefined()
    expect(row?.body).toBe("External reviewer comment")
    expect(row?.source).toBe("github")
    expect(row?.githubLogin).toBe("external-reviewer")
    expect(row?.reportId).toBe(reportId)
  })
})
