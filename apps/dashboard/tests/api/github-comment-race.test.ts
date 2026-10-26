// Regression tests for audit 2026-10-26 §4 high #5: dashboard comment →
// GitHub race. reconcile creates the GitHub comment before it records the
// write-lock and stores github_comment_id, so the inbound
// `issue_comment.created` webhook could land first, insert a duplicate
// github-sourced row, and make the reconcile's UPDATE hit the unique
// constraint — which retried 5x and posted 5 more copies to GitHub.
import { setup } from "../nuxt-setup"
import { afterEach, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import { createHmac } from "node:crypto"
import { eq, sql } from "drizzle-orm"
import type { GitHubInstallationClient } from "@reprojs/integrations-github"
import type { Octokit } from "@octokit/rest"
import { db } from "../../server/db"
import { githubIntegrations, reportComments, reports } from "../../server/db/schema"
import { withBotFooter } from "../../server/lib/comment-serializer"
import { env } from "../../server/lib/env"
import { __setClientOverride } from "../../server/lib/github"
import { reconcileCommentUpsertJob } from "../../server/lib/github-reconcile"
import {
  createUser,
  seedGithubApp,
  seedProject,
  truncateDomain,
  truncateGithub,
  truncateGithubApp,
  truncateReports,
} from "../helpers"

await setup({ server: true, port: 3000, host: "localhost" })
setDefaultTimeout(60000)

const BASE_URL = process.env.TEST_BASE_URL ?? "http://localhost:3000"
const PK = "rp_pk_COMMENTRACE000000000000"
const SECRET = "test-webhook-secret"

function sign(payload: string): string {
  return `sha256=${createHmac("sha256", SECRET).update(payload).digest("hex")}`
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

async function seedLinkedReport() {
  const ownerId = await createUser("owner-race@example.com", "admin")
  const pid = await seedProject({
    name: "comment-race",
    publicKey: PK,
    allowedOrigins: ["http://localhost:4000"],
    createdBy: ownerId,
  })
  await db.insert(githubIntegrations).values({
    projectId: pid,
    installationId: 40,
    repoOwner: "acme",
    repoName: "frontend",
    status: "connected",
  })
  const [report] = await db
    .insert(reports)
    .values({ projectId: pid, title: "Race", context: {}, githubIssueNumber: 42 })
    .returning()
  if (!report) throw new Error("seed failed")
  const [comment] = await db
    .insert(reportComments)
    .values({
      reportId: report.id,
      userId: ownerId,
      body: "Looks like a cache bug",
      source: "dashboard",
    })
    .returning()
  if (!comment) throw new Error("seed failed")
  return { pid, ownerId, reportId: report.id, comment }
}

function makeClient(createdCommentId: number) {
  const octokit = {
    rest: {
      issues: {
        createComment: async (args: { body: string }) => ({
          data: {
            id: createdCommentId,
            body: args.body,
            user: { id: 1, login: "repro-bot", avatar_url: "" },
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        }),
      },
    },
  } as unknown as Octokit
  return {
    createIssue: async () => ({ number: 42, nodeId: "N", url: "u" }),
    getIssue: async () => ({ state: "open", labels: [] }),
    closeIssue: async () => {},
    reopenIssue: async () => {},
    updateIssueLabels: async () => {},
    listInstallationRepositories: async () => [],
    findIssueByMarker: async () => null,
    getRawOctokit: () => octokit,
  } as unknown as GitHubInstallationClient
}

beforeAll(async () => {
  await truncateGithubApp()
  await seedGithubApp()
})

describe("dashboard comment → GitHub race", () => {
  afterEach(async () => {
    __setClientOverride(null)
    await db.execute(sql`TRUNCATE github_write_locks RESTART IDENTITY CASCADE`)
    await truncateGithub()
    await truncateReports()
    await truncateDomain()
  })

  test("inbound issue_comment.created for our own pending comment links it instead of duplicating", async () => {
    const { reportId, comment } = await seedLinkedReport()
    // What GitHub sends back: the body reconcile serialized, footer included.
    const echoedBody = withBotFooter(
      comment.body,
      { name: "Owner", githubLogin: null },
      env.BETTER_AUTH_SECRET,
    )

    const res = await sendWebhook("issue_comment", {
      action: "created",
      comment: {
        id: 5001,
        body: echoedBody,
        user: { id: 1, login: "repro-bot", avatar_url: "" },
      },
      issue: { number: 42 },
      repository: { name: "frontend", owner: { login: "acme" } },
      installation: { id: 40 },
    })
    expect(res.status).toBe(202)

    const rows = await db.select().from(reportComments).where(eq(reportComments.reportId, reportId))
    expect(rows).toHaveLength(1)
    expect(rows[0]?.id).toBe(comment.id)
    expect(rows[0]?.source).toBe("dashboard")
    expect(rows[0]?.githubCommentId).toBe(5001)
  })

  test("a genuinely new GitHub comment with the same text as an already-linked one is still inserted", async () => {
    const { reportId, comment } = await seedLinkedReport()
    await db
      .update(reportComments)
      .set({ githubCommentId: 4000 })
      .where(eq(reportComments.id, comment.id))

    const res = await sendWebhook("issue_comment", {
      action: "created",
      comment: {
        id: 5002,
        body: comment.body,
        user: { id: 2, login: "someone-else", avatar_url: "" },
      },
      issue: { number: 42 },
      repository: { name: "frontend", owner: { login: "acme" } },
      installation: { id: 40 },
    })
    expect(res.status).toBe(202)
    const rows = await db.select().from(reportComments).where(eq(reportComments.reportId, reportId))
    expect(rows).toHaveLength(2)
  })

  test("reconcile treats a unique violation on github_comment_id as already linked", async () => {
    const { reportId, comment } = await seedLinkedReport()
    // The webhook already inserted the echo under id 8001 before reconcile
    // got to store the id on the dashboard comment.
    await db.insert(reportComments).values({
      reportId,
      githubLogin: "repro-bot",
      body: comment.body,
      githubCommentId: 8001,
      source: "github",
    })
    __setClientOverride(() => makeClient(8001))

    // Before the fix this threw on the UPDATE and the job retried.
    await reconcileCommentUpsertJob(reportId, comment.id)

    const rows = await db.select().from(reportComments).where(eq(reportComments.reportId, reportId))
    expect(rows).toHaveLength(1)
    expect(rows[0]?.id).toBe(comment.id)
    expect(rows[0]?.githubCommentId).toBe(8001)
  })
})
