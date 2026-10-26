// apps/dashboard/tests/api/comments.test.ts
import { setup } from "../nuxt-setup"
import { afterEach, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import { eq } from "drizzle-orm"
import { db } from "../../server/db"
import {
  githubIntegrations,
  projectMembers,
  reportComments,
  reportSyncJobs,
  reports,
} from "../../server/db/schema"
import {
  apiFetch,
  createUser,
  seedProject,
  signIn,
  truncateDomain,
  truncateReports,
} from "../helpers"

await setup({ server: true, port: 3000, host: "localhost" })

setDefaultTimeout(60000)

const BASE_URL = process.env.TEST_BASE_URL ?? "http://localhost:3000"
const PK = "rp_pk_COMMENTS0000000000000000"
const ORIGIN = "http://localhost:4000"

async function seedReport(projectId: string): Promise<string> {
  const [row] = await db
    .insert(reports)
    .values({
      projectId,
      title: "Test report",
      description: "d",
      context: {
        pageUrl: "http://localhost:4000",
        userAgent: "UA",
        viewport: { w: 1000, h: 800 },
        timestamp: new Date().toISOString(),
      },
    })
    .returning({ id: reports.id })
  if (!row) throw new Error("seedReport failed")
  return row.id
}

async function seedLinkedReport(projectId: string): Promise<string> {
  const [row] = await db
    .insert(reports)
    .values({
      projectId,
      title: "Linked report",
      description: "d",
      context: {
        pageUrl: "http://localhost:4000",
        userAgent: "UA",
        viewport: { w: 1000, h: 800 },
        timestamp: new Date().toISOString(),
      },
      githubIssueNumber: 99,
      githubIssueUrl: "https://github.com/acme/repo/issues/99",
    })
    .returning({ id: reports.id })
  if (!row) throw new Error("seedLinkedReport failed")
  return row.id
}

async function seedMember(
  email: string,
  projectId: string,
  role: "viewer" | "manager" | "developer" | "owner",
): Promise<{ userId: string; cookie: string }> {
  const userId = await createUser(email, "member")
  await db.insert(projectMembers).values({ projectId, userId, role })
  const cookie = await signIn(email)
  return { userId, cookie }
}

async function seedGithubIntegration(projectId: string): Promise<void> {
  await db.insert(githubIntegrations).values({
    projectId,
    installationId: 777,
    repoOwner: "acme",
    repoName: "repo",
    status: "connected",
  })
}

describe("comments API", () => {
  beforeAll(async () => {
    await truncateReports()
    await truncateDomain()
  })
  afterEach(async () => {
    // Clean up in correct order (FKs)
    await db.execute(`TRUNCATE report_sync_jobs, github_integrations RESTART IDENTITY CASCADE`)
    await truncateReports()
    await truncateDomain()
  })

  test("GET returns empty list for a report with no comments", async () => {
    const adminId = await createUser("admin-get@example.com", "admin")
    const projectId = await seedProject({
      name: "p",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: adminId,
    })
    const reportId = await seedReport(projectId)
    const cookie = await signIn("admin-get@example.com")

    const { status, body } = await apiFetch<{ items: unknown[] }>(
      `/api/projects/${projectId}/reports/${reportId}/comments`,
      { headers: { cookie } },
    )
    expect(status).toBe(200)
    expect(body.items).toHaveLength(0)
  })

  test("POST creates a dashboard comment", async () => {
    const adminId = await createUser("admin-post@example.com", "admin")
    const projectId = await seedProject({
      name: "p",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: adminId,
    })
    const reportId = await seedReport(projectId)
    const cookie = await signIn("admin-post@example.com")

    const { status, body } = await apiFetch<{ comment: { id: string; source: string } }>(
      `/api/projects/${projectId}/reports/${reportId}/comments`,
      {
        method: "POST",
        headers: { cookie },
        body: JSON.stringify({ body: "Hello from dashboard" }),
      },
    )
    expect(status).toBe(201)
    expect(body.comment.source).toBe("dashboard")

    // Verify the row is in the database
    const [row] = await db
      .select()
      .from(reportComments)
      .where(eq(reportComments.id, body.comment.id))
    expect(row?.body).toBe("Hello from dashboard")
  })

  test("POST on a linked report with connected integration enqueues a comment_upsert job", async () => {
    const adminId = await createUser("admin-enq@example.com", "admin")
    const projectId = await seedProject({
      name: "p",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: adminId,
    })
    await seedGithubIntegration(projectId)
    const reportId = await seedLinkedReport(projectId)
    const cookie = await signIn("admin-enq@example.com")

    const { status, body } = await apiFetch<{ comment: { id: string } }>(
      `/api/projects/${projectId}/reports/${reportId}/comments`,
      {
        method: "POST",
        headers: { cookie },
        body: JSON.stringify({ body: "Synced comment" }),
      },
    )
    expect(status).toBe(201)

    // Should have a sync job queued
    const [job] = await db
      .select()
      .from(reportSyncJobs)
      .where(eq(reportSyncJobs.reportId, reportId))
    expect(job).toBeDefined()
    expect(job?.payload?.kind).toBe("comment_upsert")
    expect(job?.payload?.commentId).toBe(body.comment.id)
  })

  test("POST on an unlinked report does NOT enqueue a sync job", async () => {
    const adminId = await createUser("admin-nolink@example.com", "admin")
    const projectId = await seedProject({
      name: "p",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: adminId,
    })
    await seedGithubIntegration(projectId)
    const reportId = await seedReport(projectId) // no github issue number
    const cookie = await signIn("admin-nolink@example.com")

    await apiFetch(`/api/projects/${projectId}/reports/${reportId}/comments`, {
      method: "POST",
      headers: { cookie },
      body: JSON.stringify({ body: "No sync needed" }),
    })

    const jobs = await db.select().from(reportSyncJobs).where(eq(reportSyncJobs.reportId, reportId))
    expect(jobs).toHaveLength(0)
  })

  test("PATCH own comment succeeds for manager", async () => {
    const adminId = await createUser("admin-patch@example.com", "admin")
    const projectId = await seedProject({
      name: "p",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: adminId,
    })
    const reportId = await seedReport(projectId)
    const { userId, cookie } = await seedMember("manager@example.com", projectId, "manager")

    // Insert a comment owned by this user
    const [comment] = await db
      .insert(reportComments)
      .values({
        reportId,
        userId,
        body: "Original",
        source: "dashboard",
      })
      .returning()

    const { status, body } = await apiFetch<{ comment: { body: string } }>(
      `/api/projects/${projectId}/reports/${reportId}/comments/${comment.id}`,
      {
        method: "PATCH",
        headers: { cookie },
        body: JSON.stringify({ body: "Updated" }),
      },
    )
    expect(status).toBe(200)
    expect(body.comment.body).toBe("Updated")
  })

  test("PATCH someone else's comment is forbidden for manager, project owner and install admin", async () => {
    const adminId = await createUser("admin-perm@example.com", "admin")
    const projectId = await seedProject({
      name: "p",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: adminId,
    })
    const reportId = await seedReport(projectId)
    const { userId: authorId } = await seedMember("author@example.com", projectId, "manager")
    const { cookie: managerCookie } = await seedMember(
      "other-manager@example.com",
      projectId,
      "manager",
    )
    const { cookie: ownerCookie } = await seedMember("owner-user@example.com", projectId, "owner")
    const adminCookie = await signIn("admin-perm@example.com")

    const [comment] = await db
      .insert(reportComments)
      .values({
        reportId,
        userId: authorId,
        body: "Original body",
        source: "dashboard",
      })
      .returning()

    // An edit keeps the author's attribution (and syncs to GitHub under it),
    // so nobody but the author may change the body — not even an owner.
    for (const cookie of [managerCookie, ownerCookie, adminCookie]) {
      // eslint-disable-next-line no-await-in-loop -- sequential requests keep the assertions readable
      const { status } = await apiFetch(
        `/api/projects/${projectId}/reports/${reportId}/comments/${comment.id}`,
        {
          method: "PATCH",
          headers: { cookie },
          body: JSON.stringify({ body: "Changed" }),
        },
      )
      expect(status).toBe(403)
    }

    const [row] = await db.select().from(reportComments).where(eq(reportComments.id, comment.id))
    expect(row?.body).toBe("Original body")
  })

  test("PATCH a GitHub-originated comment is forbidden for everyone", async () => {
    const adminId = await createUser("admin-ghpatch@example.com", "admin")
    const projectId = await seedProject({
      name: "p",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: adminId,
    })
    const reportId = await seedLinkedReport(projectId)
    const { cookie: ownerCookie } = await seedMember("gh-owner@example.com", projectId, "owner")
    const adminCookie = await signIn("admin-ghpatch@example.com")

    const [comment] = await db
      .insert(reportComments)
      .values({
        reportId,
        userId: null,
        githubLogin: "octocat",
        body: "From GitHub",
        source: "github",
        githubCommentId: 4242,
      })
      .returning()

    for (const cookie of [ownerCookie, adminCookie]) {
      // eslint-disable-next-line no-await-in-loop -- sequential requests keep the assertions readable
      const { status } = await apiFetch(
        `/api/projects/${projectId}/reports/${reportId}/comments/${comment.id}`,
        {
          method: "PATCH",
          headers: { cookie },
          body: JSON.stringify({ body: "Rewritten" }),
        },
      )
      expect(status).toBe(403)
    }

    const [row] = await db.select().from(reportComments).where(eq(reportComments.id, comment.id))
    expect(row?.body).toBe("From GitHub")
  })

  test("DELETE someone else's comment is forbidden for project owner and install admin", async () => {
    const adminId = await createUser("admin-delperm@example.com", "admin")
    const projectId = await seedProject({
      name: "p",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: adminId,
    })
    const reportId = await seedReport(projectId)
    const { userId: authorId, cookie: authorCookie } = await seedMember(
      "del-author@example.com",
      projectId,
      "manager",
    )
    const { cookie: ownerCookie } = await seedMember("del-owner@example.com", projectId, "owner")
    const adminCookie = await signIn("admin-delperm@example.com")

    const [comment] = await db
      .insert(reportComments)
      .values({ reportId, userId: authorId, body: "Mine", source: "dashboard" })
      .returning()

    for (const cookie of [ownerCookie, adminCookie]) {
      // eslint-disable-next-line no-await-in-loop -- sequential requests keep the assertions readable
      const { status } = await apiFetch(
        `/api/projects/${projectId}/reports/${reportId}/comments/${comment.id}`,
        { method: "DELETE", headers: { cookie } },
      )
      expect(status).toBe(403)
    }
    const [kept] = await db.select().from(reportComments).where(eq(reportComments.id, comment.id))
    expect(kept?.deletedAt).toBeNull()

    // The author can still delete their own comment.
    const { status: authorStatus } = await apiFetch(
      `/api/projects/${projectId}/reports/${reportId}/comments/${comment.id}`,
      { method: "DELETE", headers: { cookie: authorCookie } },
    )
    expect(authorStatus).toBe(204)
  })

  test("DELETE a GitHub-originated comment is forbidden for everyone", async () => {
    const adminId = await createUser("admin-ghdel@example.com", "admin")
    const projectId = await seedProject({
      name: "p",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: adminId,
    })
    await seedGithubIntegration(projectId)
    const reportId = await seedLinkedReport(projectId)
    const { cookie: ownerCookie } = await seedMember("ghdel-owner@example.com", projectId, "owner")
    const adminCookie = await signIn("admin-ghdel@example.com")

    const [comment] = await db
      .insert(reportComments)
      .values({
        reportId,
        userId: null,
        githubLogin: "octocat",
        body: "From GitHub",
        source: "github",
        githubCommentId: 4343,
      })
      .returning()

    for (const cookie of [ownerCookie, adminCookie]) {
      // eslint-disable-next-line no-await-in-loop -- sequential requests keep the assertions readable
      const { status } = await apiFetch(
        `/api/projects/${projectId}/reports/${reportId}/comments/${comment.id}`,
        { method: "DELETE", headers: { cookie } },
      )
      expect(status).toBe(403)
    }

    const [row] = await db.select().from(reportComments).where(eq(reportComments.id, comment.id))
    expect(row?.deletedAt).toBeNull()
    const jobs = await db.select().from(reportSyncJobs).where(eq(reportSyncJobs.reportId, reportId))
    expect(jobs).toHaveLength(0)
  })

  test("DELETE soft-deletes and enqueues comment_delete for linked comments", async () => {
    const adminId = await createUser("admin-del@example.com", "admin")
    const projectId = await seedProject({
      name: "p",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: adminId,
    })
    await seedGithubIntegration(projectId)
    const reportId = await seedLinkedReport(projectId)
    const cookie = await signIn("admin-del@example.com")

    // Insert a comment that's already synced to GitHub
    const [comment] = await db
      .insert(reportComments)
      .values({
        reportId,
        userId: adminId,
        body: "To be deleted",
        source: "dashboard",
        githubCommentId: 500,
      })
      .returning()

    const { status } = await apiFetch(
      `/api/projects/${projectId}/reports/${reportId}/comments/${comment.id}`,
      { method: "DELETE", headers: { cookie } },
    )
    expect(status).toBe(204)

    // Verify soft delete
    const [row] = await db.select().from(reportComments).where(eq(reportComments.id, comment.id))
    expect(row?.deletedAt).toBeDefined()

    // Should have a delete job
    const [job] = await db
      .select()
      .from(reportSyncJobs)
      .where(eq(reportSyncJobs.reportId, reportId))
    expect(job?.payload?.kind).toBe("comment_delete")
  })

  test("DELETE on unsynced comment with pending upsert job deletes the job instead", async () => {
    const adminId = await createUser("admin-del2@example.com", "admin")
    const projectId = await seedProject({
      name: "p",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: adminId,
    })
    await seedGithubIntegration(projectId)
    const reportId = await seedLinkedReport(projectId)
    const cookie = await signIn("admin-del2@example.com")

    // Insert a comment NOT yet synced (no githubCommentId)
    const [comment] = await db
      .insert(reportComments)
      .values({
        reportId,
        userId: adminId,
        body: "Never synced",
        source: "dashboard",
      })
      .returning()

    // Insert a pending upsert job for this comment — signature must match the
    // shape used by the enqueue helper (`comment_upsert:<commentId>`), because
    // the composite PK is `(reportId, signature)` and the delete handler
    // targets that exact signature.
    await db.insert(reportSyncJobs).values({
      reportId,
      signature: `comment_upsert:${comment.id}`,
      state: "pending",
      nextAttemptAt: new Date(),
      payload: { kind: "comment_upsert", commentId: comment.id },
    })

    const { status } = await apiFetch(
      `/api/projects/${projectId}/reports/${reportId}/comments/${comment.id}`,
      { method: "DELETE", headers: { cookie } },
    )
    expect(status).toBe(204)

    // The job should be deleted (not replaced with a delete job)
    const jobs = await db.select().from(reportSyncJobs).where(eq(reportSyncJobs.reportId, reportId))
    expect(jobs).toHaveLength(0)
  })

  test("upload-image matches comment posting: manager may upload, viewer may not", async () => {
    const adminId = await createUser("admin-upload@example.com", "admin")
    const projectId = await seedProject({
      name: "p",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: adminId,
    })
    const reportId = await seedReport(projectId)
    const { cookie: managerCookie } = await seedMember(
      "upload-manager@example.com",
      projectId,
      "manager",
    )
    const { cookie: viewerCookie } = await seedMember(
      "upload-viewer@example.com",
      projectId,
      "viewer",
    )

    // 1×1 transparent PNG. apiFetch JSON-encodes bodies, so multipart goes
    // through fetch directly.
    const png = Uint8Array.from(
      atob(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
      ),
      (c) => c.charCodeAt(0),
    )
    const upload = (cookie: string) => {
      const form = new FormData()
      form.append("file", new Blob([png], { type: "image/png" }), "pasted.png")
      return fetch(
        `${BASE_URL}/api/projects/${projectId}/reports/${reportId}/comments/upload-image`,
        { method: "POST", headers: { cookie }, body: form },
      )
    }

    const managerRes = await upload(managerCookie)
    expect(managerRes.status).toBe(200)
    const managerBody = (await managerRes.json()) as { url: string; contentType: string }
    expect(managerBody.contentType).toBe("image/png")
    expect(managerBody.url).toContain("/comments/uploads/")

    const viewerRes = await upload(viewerCookie)
    expect(viewerRes.status).toBe(403)
  })

  test("GET returns comments after creation", async () => {
    const adminId = await createUser("admin-list@example.com", "admin")
    const projectId = await seedProject({
      name: "p",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: adminId,
    })
    const reportId = await seedReport(projectId)
    const cookie = await signIn("admin-list@example.com")

    await apiFetch(`/api/projects/${projectId}/reports/${reportId}/comments`, {
      method: "POST",
      headers: { cookie },
      body: JSON.stringify({ body: "First" }),
    })
    await apiFetch(`/api/projects/${projectId}/reports/${reportId}/comments`, {
      method: "POST",
      headers: { cookie },
      body: JSON.stringify({ body: "Second" }),
    })

    const { body } = await apiFetch<{ items: Array<{ body: string }> }>(
      `/api/projects/${projectId}/reports/${reportId}/comments`,
      { headers: { cookie } },
    )
    expect(body.items).toHaveLength(2)
    expect(body.items[0].body).toBe("First")
    expect(body.items[1].body).toBe("Second")
  })
})
