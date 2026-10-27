// apps/dashboard/tests/api/report-thread.test.ts
//
// GET /api/projects/:id/reports/:reportId/thread — the reports linked to the
// same GitHub issue, shown as a thread on the report page.
import { setup } from "../nuxt-setup"
import { setDefaultTimeout } from "bun:test"
setDefaultTimeout(30000)
import { afterEach, describe, expect, test } from "bun:test"
import type { ReportThreadDTO } from "@reprojs/shared"
import { db } from "../../server/db"
import { projectMembers, reports } from "../../server/db/schema"
import {
  apiFetch,
  createUser,
  seedProject,
  signIn,
  truncateDomain,
  truncateReports,
} from "../helpers"

await setup({ server: true, port: 3000, host: "localhost" })

const ORIGIN = "http://localhost:4000"
const ISSUE_URL = "https://github.com/acme/frontend/issues/42"

async function seedReport(
  projectId: string,
  opts: {
    title: string
    createdAt: Date
    issueNumber?: number
    linkKind?: "created" | "attached"
    reporter?: { name?: string; email?: string }
  },
): Promise<string> {
  const [row] = await db
    .insert(reports)
    .values({
      projectId,
      title: opts.title,
      context: {
        pageUrl: "http://localhost:4000/checkout",
        userAgent: "UA",
        viewport: { w: 1000, h: 800 },
        timestamp: opts.createdAt.toISOString(),
        reporter: opts.reporter,
      } as (typeof reports.$inferInsert)["context"],
      createdAt: opts.createdAt,
      githubIssueNumber: opts.issueNumber,
      githubIssueUrl: opts.issueNumber
        ? `https://github.com/acme/frontend/issues/${opts.issueNumber}`
        : undefined,
      githubLinkKind: opts.linkKind,
    })
    .returning({ id: reports.id })
  if (!row) throw new Error("seed failed")
  return row.id
}

const day = (n: number) => new Date(Date.UTC(2026, 9, n, 12))

describe("report thread API", () => {
  afterEach(async () => {
    await truncateReports()
    await truncateDomain()
  })

  test("lists every report on the same issue, issue opener first, scoped to the project", async () => {
    const owner = await createUser("owner@example.com", "admin")
    const pid = await seedProject({
      name: "Shop",
      publicKey: "rp_pk_THRD1234567890abcdef1234",
      allowedOrigins: [ORIGIN],
      createdBy: owner,
    })
    const other = await seedProject({
      name: "Other",
      publicKey: "rp_pk_THRD2234567890abcdef1234",
      allowedOrigins: [ORIGIN],
      createdBy: owner,
    })

    // Submitted before the issue existed, attached later: older than the
    // opener but must still come after it.
    const early = await seedReport(pid, {
      title: "Pay fails on Safari",
      createdAt: day(1),
      issueNumber: 42,
      linkKind: "attached",
      reporter: { email: "bob@example.com" },
    })
    const opener = await seedReport(pid, {
      title: "Checkout button broken",
      createdAt: day(3),
      issueNumber: 42,
      linkKind: "created",
      reporter: { name: "Jane", email: "jane@example.com" },
    })
    const late = await seedReport(pid, {
      title: "Same here, iPhone",
      createdAt: day(5),
      issueNumber: 42,
      linkKind: "attached",
    })
    // Decoys: a different issue in this project, and the same number in a
    // different project (another repo).
    await seedReport(pid, {
      title: "Login slow",
      createdAt: day(2),
      issueNumber: 43,
      linkKind: "created",
    })
    await seedReport(other, {
      title: "Other repo #42",
      createdAt: day(2),
      issueNumber: 42,
      linkKind: "created",
    })
    const unlinked = await seedReport(pid, { title: "Typo on pricing", createdAt: day(4) })

    // A plain project viewer can read the thread.
    const viewerId = await createUser("viewer@example.com", "member")
    await db.insert(projectMembers).values({ projectId: pid, userId: viewerId, role: "viewer" })
    const viewer = await signIn("viewer@example.com")

    // Same thread from whichever member you open it.
    const fromEach = await Promise.all(
      [late, early, opener].map((from) =>
        apiFetch<ReportThreadDTO>(`/api/projects/${pid}/reports/${from}/thread`, {
          headers: { cookie: viewer },
        }),
      ),
    )
    for (const { status, body } of fromEach) {
      expect(status).toBe(200)
      expect(body.issueNumber).toBe(42)
      expect(body.issueUrl).toBe(ISSUE_URL)
      expect(body.items.map((i) => i.id)).toEqual([opener, early, late])
    }

    const { body } = await apiFetch<ReportThreadDTO>(
      `/api/projects/${pid}/reports/${opener}/thread`,
      { headers: { cookie: viewer } },
    )
    expect(body.items[0]).toMatchObject({
      title: "Checkout button broken",
      reporterName: "Jane",
      reporterEmail: "jane@example.com",
      githubLinkKind: "created",
      status: "open",
      receivedAt: day(3).toISOString(),
    })
    expect(body.items[1]).toMatchObject({ reporterName: null, reporterEmail: "bob@example.com" })
    expect(body.items[2]).toMatchObject({ reporterName: null, reporterEmail: null })

    // An unlinked report has no thread.
    const none = await apiFetch<ReportThreadDTO>(
      `/api/projects/${pid}/reports/${unlinked}/thread`,
      { headers: { cookie: viewer } },
    )
    expect(none.status).toBe(200)
    expect(none.body).toEqual({ issueNumber: null, issueUrl: null, items: [] })

    // A report id from another project can't be read through this one.
    const otherReport = await seedReport(other, { title: "x", createdAt: day(6) })
    const cross = await apiFetch(`/api/projects/${pid}/reports/${otherReport}/thread`, {
      headers: { cookie: viewer },
    })
    expect(cross.status).toBe(404)

    // Someone outside the project is refused.
    await createUser("stranger@example.com", "member")
    const stranger = await signIn("stranger@example.com")
    const refused = await apiFetch(`/api/projects/${pid}/reports/${opener}/thread`, {
      headers: { cookie: stranger },
    })
    expect([403, 404]).toContain(refused.status)
  })
})
