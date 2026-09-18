// apps/dashboard/tests/api/inbox.test.ts
import { setup } from "../nuxt-setup"
import { setDefaultTimeout } from "bun:test"
setDefaultTimeout(30000)
import { afterEach, describe, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import {
  apiFetch,
  createUser,
  seedProject,
  signIn,
  truncateDomain,
  truncateReports,
} from "../helpers"
import { db } from "../../server/db"
import {
  githubIntegrations,
  projectMembers,
  reportAssignees,
  reportEvents,
  reports,
  userIdentities,
} from "../../server/db/schema"

await setup({ server: true, port: 3000, host: "localhost" })

const PK = "rp_pk_INBX1234567890abcdef1234"
const ORIGIN = "http://localhost:4000"

async function seedReport(
  projectId: string,
  overrides: Omit<Partial<typeof reports.$inferInsert>, "assigneeId"> = {},
): Promise<string> {
  const [row] = await db
    .insert(reports)
    .values({
      projectId,
      title: overrides.title ?? "Seed report",
      description: overrides.description ?? null,
      context:
        overrides.context ??
        ({
          pageUrl: "http://localhost:4000/p",
          userAgent: "UA",
          viewport: { w: 1000, h: 800 },
          timestamp: new Date().toISOString(),
        } as (typeof reports.$inferInsert)["context"]),
      status: overrides.status ?? "open",
      priority: overrides.priority ?? "normal",
      tags: overrides.tags ?? [],
      githubIssueNumber: overrides.githubIssueNumber,
      githubIssueUrl: overrides.githubIssueUrl,
    })
    .returning({ id: reports.id })
  return row?.id
}

async function addMember(projectId: string, userId: string, role: "developer" | "viewer") {
  await db.insert(projectMembers).values({ projectId, userId, role })
}

describe("ticket inbox API", () => {
  afterEach(async () => {
    await truncateReports()
    await truncateDomain()
  })

  test("list filters by status CSV", async () => {
    const owner = await createUser("owner@example.com", "admin")
    const pid = await seedProject({
      name: "Inbox",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: owner,
    })
    await seedReport(pid, { status: "open" })
    await seedReport(pid, { status: "open" })
    await seedReport(pid, { status: "in_progress" })
    await seedReport(pid, { status: "closed" })
    const cookie = await signIn("owner@example.com")
    const { status, body } = await apiFetch<{ items: Array<{ status: string }>; total: number }>(
      `/api/projects/${pid}/reports?status=open,in_progress`,
      { headers: { cookie } },
    )
    expect(status).toBe(200)
    expect(body.total).toBe(3)
    expect(new Set(body.items.map((i) => i.status))).toEqual(new Set(["open", "in_progress"]))
  })

  test("list filters by assignee=me", async () => {
    const owner = await createUser("owner@example.com", "admin")
    // The "me" filter resolves to the session user's linked github handle —
    // plant an identity for owner so the filter resolves to a real login.
    await db.insert(userIdentities).values({
      userId: owner,
      provider: "github",
      externalId: "gh-owner-1",
      externalHandle: "owner-gh",
      externalAvatarUrl: null,
      externalName: null,
      externalEmail: null,
    })
    const pid = await seedProject({
      name: "Inbox",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: owner,
    })
    const r1 = await seedReport(pid)
    await db.insert(reportAssignees).values({ reportId: r1, githubLogin: "owner-gh" })
    await seedReport(pid) // unassigned
    const cookie = await signIn("owner@example.com")
    const { status, body } = await apiFetch<{
      items: Array<{ assignees: Array<{ login: string }> }>
    }>(`/api/projects/${pid}/reports?assignee=me`, { headers: { cookie } })
    expect(status).toBe(200)
    expect(body.items.length).toBe(1)
    expect(body.items[0]?.assignees[0]?.login).toBe("owner-gh")
  })

  test("list filters by tag AND semantics", async () => {
    const owner = await createUser("owner@example.com", "admin")
    const pid = await seedProject({
      name: "Inbox",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: owner,
    })
    await seedReport(pid, { tags: ["mobile", "ios"] })
    await seedReport(pid, { tags: ["mobile"] })
    await seedReport(pid, { tags: ["ios"] })
    const cookie = await signIn("owner@example.com")
    const { body } = await apiFetch<{ items: Array<{ tags: string[] }>; total: number }>(
      `/api/projects/${pid}/reports?tag=mobile,ios`,
      { headers: { cookie } },
    )
    expect(body.total).toBe(1)
    expect([...(body.items[0]?.tags ?? [])].toSorted()).toEqual(["ios", "mobile"])
  })

  test("text search is case-insensitive on title and description", async () => {
    const owner = await createUser("owner@example.com", "admin")
    const pid = await seedProject({
      name: "Inbox",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: owner,
    })
    await seedReport(pid, { title: "Checkout crash on Safari" })
    await seedReport(pid, { description: "the CHECKOUT is slow" })
    await seedReport(pid, { title: "Unrelated" })
    const cookie = await signIn("owner@example.com")
    const { body } = await apiFetch<{ total: number }>(`/api/projects/${pid}/reports?q=checkout`, {
      headers: { cookie },
    })
    expect(body.total).toBe(2)
  })

  test("facet counts reflect current filter set", async () => {
    const owner = await createUser("owner@example.com", "admin")
    const pid = await seedProject({
      name: "Inbox",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: owner,
    })
    await seedReport(pid, { status: "open", priority: "high" })
    await seedReport(pid, { status: "open", priority: "low" })
    await seedReport(pid, { status: "closed", priority: "high" })
    const cookie = await signIn("owner@example.com")
    const { body } = await apiFetch<{
      facets: { priority: Record<string, number>; status: Record<string, number> }
    }>(`/api/projects/${pid}/reports?status=open`, { headers: { cookie } })
    expect(body.facets.priority.high).toBe(1)
    expect(body.facets.priority.low).toBe(1)
    expect(body.facets.status.open).toBe(2)
    expect(body.facets.status.closed).toBe(0)
  })

  test("PATCH single field emits exactly one event", async () => {
    const owner = await createUser("owner@example.com", "admin")
    const pid = await seedProject({
      name: "Inbox",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: owner,
    })
    const rid = await seedReport(pid)
    const cookie = await signIn("owner@example.com")
    const { status } = await apiFetch(`/api/projects/${pid}/reports/${rid}`, {
      method: "PATCH",
      headers: { cookie },
      body: { status: "in_progress" },
    })
    expect(status).toBe(200)
    const evs = await db.select().from(reportEvents).where(eq(reportEvents.reportId, rid))
    expect(evs.length).toBe(1)
    expect(evs[0]?.kind).toBe("status_changed")
  })

  test("PATCH multiple fields emits one event per changed field", async () => {
    const owner = await createUser("owner@example.com", "admin")
    const pid = await seedProject({
      name: "Inbox",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: owner,
    })
    // Link the project + report so the assignee field is accepted (assignees
    // are GitHub-mirrored and require a linked issue).
    await db.insert(githubIntegrations).values({
      projectId: pid,
      installationId: 99,
      repoOwner: "acme",
      repoName: "widgets",
      status: "connected",
      pushOnEdit: false,
      autoCreateOnIntake: false,
    })
    const rid = await seedReport(pid, {
      githubIssueNumber: 42,
      githubIssueUrl: "https://github.com/acme/widgets/issues/42",
    })
    const cookie = await signIn("owner@example.com")
    await apiFetch(`/api/projects/${pid}/reports/${rid}`, {
      method: "PATCH",
      headers: { cookie },
      body: { status: "in_progress", priority: "high", assignees: ["alice"] },
    })
    const evs = await db.select().from(reportEvents).where(eq(reportEvents.reportId, rid))
    expect(evs.length).toBe(3)
    expect(new Set(evs.map((e) => e.kind))).toEqual(
      new Set(["status_changed", "priority_changed", "assignee_added"]),
    )
  })

  test("PATCH tags diffs into per-add/per-remove events", async () => {
    const owner = await createUser("owner@example.com", "admin")
    const pid = await seedProject({
      name: "Inbox",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: owner,
    })
    const rid = await seedReport(pid, { tags: ["a", "b"] })
    const cookie = await signIn("owner@example.com")
    await apiFetch(`/api/projects/${pid}/reports/${rid}`, {
      method: "PATCH",
      headers: { cookie },
      body: { tags: ["a", "c"] },
    })
    const evs = await db.select().from(reportEvents).where(eq(reportEvents.reportId, rid))
    const kinds = evs.map((e) => e.kind).toSorted()
    expect(kinds).toEqual(["tag_added", "tag_removed"])
  })

  test("bulk-update returns only reports that actually changed", async () => {
    const owner = await createUser("owner@example.com", "admin")
    const pid = await seedProject({
      name: "Inbox",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: owner,
    })
    const r1 = await seedReport(pid, { status: "open" })
    const r2 = await seedReport(pid, { status: "open" })
    const r3 = await seedReport(pid, { status: "resolved" })
    const cookie = await signIn("owner@example.com")
    const { body } = await apiFetch<{ updated: string[] }>(
      `/api/projects/${pid}/reports/bulk-update`,
      {
        method: "POST",
        headers: { cookie },
        body: { reportIds: [r1, r2, r3], status: "resolved" },
      },
    )
    expect([...body.updated].toSorted()).toEqual([r1, r2].toSorted())
  })

  test("viewer cannot PATCH", async () => {
    const owner = await createUser("owner@example.com", "admin")
    const viewer = await createUser("viewer@example.com", "member")
    const pid = await seedProject({
      name: "Inbox",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: owner,
    })
    await addMember(pid, viewer, "viewer")
    const rid = await seedReport(pid)
    const cookie = await signIn("viewer@example.com")
    const { status } = await apiFetch(`/api/projects/${pid}/reports/${rid}`, {
      method: "PATCH",
      headers: { cookie },
      body: { status: "closed" },
    })
    expect(status).toBe(403)
    const [current] = await db.select().from(reports).where(eq(reports.id, rid))
    expect(current?.status).toBe("open")
  })

  test("assigning on an unlinked report returns 409", async () => {
    const owner = await createUser("owner@example.com", "admin")
    const pid = await seedProject({
      name: "Inbox",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: owner,
    })
    // Report has no githubIssueNumber → assignees have nowhere to round-trip.
    const rid = await seedReport(pid)
    const cookie = await signIn("owner@example.com")
    const { status } = await apiFetch(`/api/projects/${pid}/reports/${rid}`, {
      method: "PATCH",
      headers: { cookie },
      body: { assignees: ["alice"] },
    })
    expect(status).toBe(409)
  })

  test("events feed returns actor-embedded DTOs in reverse-chrono", async () => {
    const owner = await createUser("owner@example.com", "admin")
    const pid = await seedProject({
      name: "Inbox",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: owner,
    })
    const rid = await seedReport(pid)
    const cookie = await signIn("owner@example.com")
    await apiFetch(`/api/projects/${pid}/reports/${rid}`, {
      method: "PATCH",
      headers: { cookie },
      body: { status: "in_progress" },
    })
    await apiFetch(`/api/projects/${pid}/reports/${rid}`, {
      method: "PATCH",
      headers: { cookie },
      body: { priority: "high" },
    })
    const { body } = await apiFetch<{
      items: Array<{ kind: string; actor: { email: string } | null }>
    }>(`/api/projects/${pid}/reports/${rid}/events`, { headers: { cookie } })
    expect(body.items.length).toBe(2)
    expect(body.items[0]?.kind).toBe("priority_changed") // newer
    expect(body.items[0]?.actor?.email).toBe("owner@example.com")
    expect(body.items[1]?.kind).toBe("status_changed") // older
  })

  describe("pagination", () => {
    // One multi-row INSERT gives every row the same `created_at` (now() is the
    // transaction timestamp), which is exactly the case a sort without a
    // tie-breaker pages non-deterministically.
    async function seedMany(projectId: string, n: number): Promise<string[]> {
      const rows = await db
        .insert(reports)
        .values(
          Array.from({ length: n }, (_, i) => ({
            projectId,
            title: `Paged ${i}`,
            context: {
              pageUrl: "http://localhost:4000/p",
              userAgent: "UA",
              viewport: { w: 1000, h: 800 },
              timestamp: new Date().toISOString(),
            } as (typeof reports.$inferInsert)["context"],
          })),
        )
        .returning({ id: reports.id })
      return rows.map((r) => r.id)
    }

    for (const sort of ["newest", "oldest", "priority", "updated"] as const) {
      test(`offset pages are disjoint and cover every row (sort=${sort})`, async () => {
        const owner = await createUser("owner@example.com", "admin")
        const pid = await seedProject({
          name: "Inbox",
          publicKey: PK,
          allowedOrigins: [ORIGIN],
          createdBy: owner,
        })
        const ids = await seedMany(pid, 600)
        const cookie = await signIn("owner@example.com")
        const page = (offset: number) =>
          apiFetch<{ items: Array<{ id: string }>; total: number }>(
            `/api/projects/${pid}/reports?sort=${sort}&limit=100&offset=${offset}`,
            { headers: { cookie } },
          )
        const pages = await Promise.all(Array.from({ length: 6 }, (_, i) => page(i * 100)))
        expect(pages[0]?.body.total).toBe(600)
        const seen = pages.flatMap((p) => p.body.items.map((r) => r.id))
        expect(seen.length).toBe(600)
        expect(new Set(seen).size).toBe(600)
        expect(new Set(seen)).toEqual(new Set(ids))
      })
    }

    test("non-numeric limit/offset fall back to defaults instead of failing", async () => {
      const owner = await createUser("owner@example.com", "admin")
      const pid = await seedProject({
        name: "Inbox",
        publicKey: PK,
        allowedOrigins: [ORIGIN],
        createdBy: owner,
      })
      await seedMany(pid, 3)
      const cookie = await signIn("owner@example.com")
      const { status, body } = await apiFetch<{ items: unknown[]; total: number }>(
        `/api/projects/${pid}/reports?limit=abc&offset=xyz`,
        { headers: { cookie } },
      )
      expect(status).toBe(200)
      expect(body.items.length).toBe(3)
    })
  })
})
