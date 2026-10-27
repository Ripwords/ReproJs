import { afterEach, describe, expect, test, setDefaultTimeout } from "bun:test"
import { eq } from "drizzle-orm"
import type { ProjectStatsDTO } from "@reprojs/shared"
import { db } from "../../server/db"
import { githubIntegrations, projectMembers, reports } from "../../server/db/schema"
import {
  apiFetch,
  createUser,
  makePngBlob,
  seedProject,
  signIn,
  truncateDomain,
  truncateGithub,
  truncateReports,
} from "../helpers"

setDefaultTimeout(30000)

const BASE_URL = process.env.TEST_BASE_URL ?? "http://localhost:3000"
const PK_A = "rp_pk_STATSA123456789abcdef012"
const PK_B = "rp_pk_STATSB123456789abcdef012"
const ORIGIN = "https://app.example.com"

function reportForm(projectKey: string, title: string): FormData {
  const fd = new FormData()
  fd.set(
    "report",
    new Blob(
      [
        JSON.stringify({
          projectKey,
          title,
          description: "d",
          context: {
            pageUrl: `${ORIGIN}/p`,
            userAgent: "UA",
            viewport: { w: 1000, h: 800 },
            timestamp: new Date().toISOString(),
          },
          _dwellMs: 2000,
        }),
      ],
      { type: "application/json" },
    ),
  )
  fd.set("screenshot", makePngBlob(), "s.png")
  return fd
}

async function intake(projectKey: string, title: string): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/intake/reports`, {
    method: "POST",
    headers: { Origin: ORIGIN },
    body: reportForm(projectKey, title),
  })
  expect(res.status).toBe(201)
  const body = (await res.json()) as { id: string }
  return body.id
}

describe("GET /api/projects/stats", () => {
  afterEach(async () => {
    await truncateReports()
    await truncateGithub()
    await truncateDomain()
  })

  test("requires auth", async () => {
    const { status } = await apiFetch("/api/projects/stats")
    expect(status).toBe(401)
  })

  test("counts open / in-progress / new-this-week per project, with last report time and repo", async () => {
    const admin = await createUser("admin@example.com", "admin")
    const cookie = await signIn("admin@example.com")
    const a = await seedProject({
      name: "A",
      publicKey: PK_A,
      allowedOrigins: [ORIGIN],
      createdBy: admin,
    })
    const b = await seedProject({
      name: "B (empty)",
      publicKey: PK_B,
      allowedOrigins: [ORIGIN],
      createdBy: admin,
    })

    const r1 = await intake(PK_A, "open one")
    const r2 = await intake(PK_A, "becomes in progress")
    const r3 = await intake(PK_A, "old and closed")
    await db.update(reports).set({ status: "in_progress" }).where(eq(reports.id, r2))
    // Older than the 7-day window and closed: counts toward total only.
    const tenDaysAgo = new Date(Date.now() - 10 * 86_400_000)
    await db
      .update(reports)
      .set({ status: "closed", createdAt: tenDaysAgo })
      .where(eq(reports.id, r3))
    await db.insert(githubIntegrations).values({
      projectId: a,
      installationId: 1,
      repoOwner: "acme",
      repoName: "frontend",
      status: "connected",
    })

    const { status, body } = await apiFetch<ProjectStatsDTO[]>("/api/projects/stats", {
      headers: { cookie },
    })
    expect(status).toBe(200)
    const rows = body as ProjectStatsDTO[]
    const statsA = rows.find((r) => r.projectId === a)
    const statsB = rows.find((r) => r.projectId === b)
    expect(statsA).toBeDefined()
    expect(statsB).toBeDefined()

    expect(statsA?.openCount).toBe(1)
    expect(statsA?.inProgressCount).toBe(1)
    expect(statsA?.newLast7Count).toBe(2)
    expect(statsA?.totalCount).toBe(3)
    expect(statsA?.github).toEqual({ repoOwner: "acme", repoName: "frontend" })
    // Newest createdAt wins even though r3 was inserted last.
    const r1Row = await db.query.reports.findFirst({ where: eq(reports.id, r1) })
    const r2Row = await db.query.reports.findFirst({ where: eq(reports.id, r2) })
    const newest = [r1Row, r2Row]
      .map((r) => r?.createdAt.getTime() ?? 0)
      .reduce((m, t) => Math.max(m, t), 0)
    expect(new Date(statsA?.lastReportAt ?? 0).getTime()).toBe(newest)

    expect(statsB).toMatchObject({
      openCount: 0,
      inProgressCount: 0,
      newLast7Count: 0,
      totalCount: 0,
      lastReportAt: null,
      github: null,
    })
  })

  test("a member only gets stats for projects they belong to", async () => {
    const admin = await createUser("admin@example.com", "admin")
    const member = await createUser("member@example.com", "member")
    const cookie = await signIn("member@example.com")
    const mine = await seedProject({
      name: "Mine",
      publicKey: PK_A,
      allowedOrigins: [ORIGIN],
      createdBy: admin,
    })
    await seedProject({
      name: "Not mine",
      publicKey: PK_B,
      allowedOrigins: [ORIGIN],
      createdBy: admin,
    })
    await db.insert(projectMembers).values({ projectId: mine, userId: member, role: "viewer" })
    await intake(PK_B, "hidden")

    const { status, body } = await apiFetch<ProjectStatsDTO[]>("/api/projects/stats", {
      headers: { cookie },
    })
    expect(status).toBe(200)
    expect((body as ProjectStatsDTO[]).map((r) => r.projectId)).toEqual([mine])
  })
})
