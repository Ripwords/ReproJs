// apps/dashboard/tests/api/github-comment-webhook.test.ts
// Tests for the issue_comment webhook branches: created/edited/deleted with write-lock echo skip.
import { setup } from "../nuxt-setup"
import { setDefaultTimeout } from "bun:test"
setDefaultTimeout(60000)
import { afterEach, beforeAll, describe, expect, test } from "bun:test"
import { eq, sql } from "drizzle-orm"
import { createHmac } from "node:crypto"
import { db } from "../../server/db"
import { githubIntegrations, reportComments, reports, userIdentities } from "../../server/db/schema"
import { signCommentDelete, signCommentUpsert } from "../../server/lib/github-diff"
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

process.env.GITHUB_APP_ID = process.env.GITHUB_APP_ID || "12345"
process.env.GITHUB_APP_PRIVATE_KEY =
  process.env.GITHUB_APP_PRIVATE_KEY ||
  "-----BEGIN RSA PRIVATE KEY-----\ntest\n-----END RSA PRIVATE KEY-----"
process.env.GITHUB_APP_WEBHOOK_SECRET = "test-webhook-secret"

await setup({ server: true, port: 3000, host: "localhost" })

const BASE_URL = process.env.TEST_BASE_URL ?? "http://localhost:3000"

const PK = "rp_pk_COMMENTWEBHOOK000000000"
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

async function seedLinkedReport() {
  const ownerId = await createUser("owner-cw@example.com", "admin")
  const pid = await seedProject({
    name: "comment-webhook",
    publicKey: PK,
    allowedOrigins: [ORIGIN],
    createdBy: ownerId,
  })
  await db.insert(githubIntegrations).values({
    projectId: pid,
    installationId: 20,
    repoOwner: "acme",
    repoName: "frontend",
    status: "connected",
  })
  const [report] = await db
    .insert(reports)
    .values({
      projectId: pid,
      title: "Test",
      context: {},
      githubIssueNumber: 42,
    })
    .returning()
  if (!report) throw new Error("seedLinkedReport failed")
  return { pid, reportId: report.id }
}

function makeCommentPayload(
  action: "created" | "edited" | "deleted",
  commentId: number,
  body: string,
  userId = 999,
  login = "gh-user",
) {
  return {
    action,
    comment: {
      id: commentId,
      body,
      user: { id: userId, login, avatar_url: "https://example.com/avatar.png" },
    },
    issue: { number: 42 },
    repository: { name: "frontend", owner: { login: "acme" } },
    installation: { id: 20 },
  }
}

beforeAll(async () => {
  process.env.ATTACHMENT_URL_SECRET = process.env.ATTACHMENT_URL_SECRET ?? "test-attachment-secret"
  await truncateGithubApp()
  await seedGithubApp()
})

describe("issue_comment webhook", () => {
  afterEach(async () => {
    await truncateWriteLocks()
    await truncateGithub()
    await truncateReports()
    await truncateDomain()
  })

  test("issue_comment.created inserts a report_comments row", async () => {
    const { reportId } = await seedLinkedReport()

    const res = await sendWebhook("issue_comment", makeCommentPayload("created", 100, "Hello!"))
    expect(res.status).toBe(202)

    const [row] = await db
      .select()
      .from(reportComments)
      .where(eq(reportComments.githubCommentId, 100))
    expect(row).toBeDefined()
    expect(row?.body).toBe("Hello!")
    expect(row?.source).toBe("github")
    expect(row?.reportId).toBe(reportId)
  })

  test("issue_comment.edited updates the existing row", async () => {
    await seedLinkedReport()

    // Insert comment first via created event
    await sendWebhook("issue_comment", makeCommentPayload("created", 200, "Original"))

    // Now edit
    const res = await sendWebhook("issue_comment", makeCommentPayload("edited", 200, "Updated"))
    expect(res.status).toBe(202)

    const [row] = await db
      .select()
      .from(reportComments)
      .where(eq(reportComments.githubCommentId, 200))
    expect(row?.body).toBe("Updated")
  })

  test("issue_comment.deleted soft-deletes the row", async () => {
    const { reportId } = await seedLinkedReport()

    // Seed comment directly in DB
    await db.insert(reportComments).values({
      reportId,
      body: "About to delete",
      githubCommentId: 300,
      source: "github",
      githubLogin: "gh-user",
    })

    const res = await sendWebhook("issue_comment", makeCommentPayload("deleted", 300, ""))
    expect(res.status).toBe(202)

    const [row] = await db
      .select()
      .from(reportComments)
      .where(eq(reportComments.githubCommentId, 300))
    expect(row?.deletedAt).toBeDefined()
  })

  test("echo skip: pre-recorded write-lock prevents duplicate insert on created", async () => {
    const { reportId } = await seedLinkedReport()
    const body = "Echo body"
    const commentId = 400

    // Pre-record a write lock as if we just pushed this comment
    await recordWriteLock(db, {
      reportId,
      kind: "comment_upsert",
      signature: signCommentUpsert(commentId, body),
    })

    // Simulate the inbound webhook
    const res = await sendWebhook("issue_comment", makeCommentPayload("created", commentId, body))
    expect(res.status).toBe(202)
    const resBody = (await res.json()) as { echo?: boolean }
    expect(resBody.echo).toBe(true)

    // No new row should be inserted
    const rows = await db
      .select()
      .from(reportComments)
      .where(eq(reportComments.githubCommentId, commentId))
    expect(rows).toHaveLength(0)
  })

  test("echo skip: pre-recorded write-lock prevents soft-delete on deleted", async () => {
    const { reportId } = await seedLinkedReport()
    const commentId = 500

    // Seed comment in DB
    await db.insert(reportComments).values({
      reportId,
      body: "Will not be deleted via echo",
      githubCommentId: commentId,
      source: "github",
      githubLogin: "gh-user",
    })

    // Pre-record the delete lock
    await recordWriteLock(db, {
      reportId,
      kind: "comment_delete",
      signature: signCommentDelete(commentId),
    })

    const res = await sendWebhook("issue_comment", makeCommentPayload("deleted", commentId, ""))
    expect(res.status).toBe(202)
    const resBody = (await res.json()) as { echo?: boolean }
    expect(resBody.echo).toBe(true)

    // Row should NOT be soft-deleted
    const [row] = await db
      .select()
      .from(reportComments)
      .where(eq(reportComments.githubCommentId, commentId))
    expect(row?.deletedAt).toBeNull()
  })

  test("author resolution: when user has identity row, userId is set", async () => {
    await seedLinkedReport()

    // Create a user with a github identity linked to github userId 999 (matches makeCommentPayload default)
    const dashboardUserId = await createUser("github-linked@example.com", "member")
    await db.insert(userIdentities).values({
      userId: dashboardUserId,
      provider: "github",
      externalId: "999",
      externalHandle: "gh-user",
    })

    await sendWebhook(
      "issue_comment",
      makeCommentPayload("created", 600, "From linked user", 999, "gh-user"),
    )

    const [row] = await db
      .select()
      .from(reportComments)
      .where(eq(reportComments.githubCommentId, 600))
    expect(row?.userId).toBe(dashboardUserId)
  })

  test("author resolution: unknown github user only sets github_login", async () => {
    await seedLinkedReport()

    await sendWebhook(
      "issue_comment",
      makeCommentPayload("created", 700, "From unknown", 88888, "unknown-user"),
    )

    const [row] = await db
      .select()
      .from(reportComments)
      .where(eq(reportComments.githubCommentId, 700))
    expect(row?.userId).toBeNull()
    expect(row?.githubLogin).toBe("unknown-user")
  })
})
