import { setup } from "../nuxt-setup"
import { afterEach, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import { eq } from "drizzle-orm"
import type { ProjectDTO, SharedMediaDTO } from "@reprojs/shared"
import { db } from "../../server/db"
import { projectMembers, projects, sharedMedia } from "../../server/db/schema"
import {
  apiFetch,
  createUser,
  seedProject,
  signIn,
  truncateDomain,
  truncateSharedMedia,
} from "../helpers"

await setup({ server: true, port: 3000, host: "localhost" })
setDefaultTimeout(15000)

const PK = "rp_pk_SHAREDMEDIAADMIN000000000"

/**
 * Seed a member-role user and add them to the given project at the specified
 * role, mirroring the helper in manager-role.test.ts. Bypasses the
 * invitation flow — the permission boundary under test is
 * authenticated-session-only.
 */
async function seedMemberAtRole(
  email: string,
  projectId: string,
  role: "viewer" | "manager" | "developer" | "owner",
): Promise<{ userId: string; cookie: string }> {
  const userId = await createUser(email, "member")
  await db.insert(projectMembers).values({ projectId, userId, role })
  const cookie = await signIn(email)
  return { userId, cookie }
}

async function seedSharedMediaRow(opts: {
  projectId: string
  createdAt: Date
  expiresAt: Date
  revokedAt?: Date | null
}): Promise<string> {
  const [row] = await db
    .insert(sharedMedia)
    .values({
      projectId: opts.projectId,
      token: `tok_${Math.random().toString(36).slice(2)}${Date.now()}`,
      kind: "video",
      mime: "video/webm",
      storageKey: `shared-media/${Math.random().toString(36).slice(2)}.webm`,
      sizeBytes: 12345,
      createdAt: opts.createdAt,
      expiresAt: opts.expiresAt,
      revokedAt: opts.revokedAt ?? null,
    })
    .returning({ id: sharedMedia.id })
  if (!row) throw new Error("seedSharedMediaRow: insert returned no row")
  return row.id
}

describe("shared-media admin API", () => {
  let ownerCookie: string
  let projectId: string
  let adminUserId: string
  let liveMediaId: string
  let expiredMediaId: string

  beforeAll(async () => {
    await truncateDomain()
    adminUserId = await createUser("share-admin-owner@example.com", "admin")
    ownerCookie = await signIn("share-admin-owner@example.com")
    projectId = await seedProject({
      name: "Shared Media Admin Test Project",
      publicKey: PK,
      createdBy: adminUserId,
    })
  })

  afterEach(async () => {
    await truncateSharedMedia()
    await db
      .update(projects)
      .set({ shareLinksEnabled: true, shareRetentionDays: 30 })
      .where(eq(projects.id, projectId))
  })

  async function seedTwoRows() {
    const now = Date.now()
    // Older row (expired) created first, newer row (live) created second —
    // list should return newest-first, i.e. the live row first.
    expiredMediaId = await seedSharedMediaRow({
      projectId,
      createdAt: new Date(now - 60_000),
      expiresAt: new Date(now - 1_000), // already expired
    })
    liveMediaId = await seedSharedMediaRow({
      projectId,
      createdAt: new Date(now),
      expiresAt: new Date(now + 60 * 24 * 60 * 60 * 1000), // far future
    })
  }

  test("owner: GET list returns two DTOs, newest (live) first", async () => {
    await seedTwoRows()
    const { status, body } = await apiFetch<SharedMediaDTO[]>(
      `/api/projects/${projectId}/shared-media`,
      { headers: { cookie: ownerCookie } },
    )
    expect(status).toBe(200)
    const list = body as SharedMediaDTO[]
    expect(list.length).toBe(2)
    expect(list[0]?.id).toBe(liveMediaId)
    expect(list[0]?.shareUrl).toContain(`/s/`)
    expect(list[1]?.id).toBe(expiredMediaId)
  })

  test("owner: DELETE live row revokes it; DELETE again is idempotent", async () => {
    await seedTwoRows()

    const { status: delStatus } = await apiFetch(
      `/api/projects/${projectId}/shared-media/${liveMediaId}`,
      { method: "DELETE", headers: { cookie: ownerCookie } },
    )
    expect(delStatus).toBe(200)

    const [afterFirst] = await db.select().from(sharedMedia).where(eq(sharedMedia.id, liveMediaId))
    expect(afterFirst?.revokedAt).not.toBeNull()
    const firstRevokedAt = afterFirst?.revokedAt?.getTime()

    // Idempotent second revoke — still 200, revokedAt timestamp unchanged.
    const { status: delStatus2 } = await apiFetch(
      `/api/projects/${projectId}/shared-media/${liveMediaId}`,
      { method: "DELETE", headers: { cookie: ownerCookie } },
    )
    expect(delStatus2).toBe(200)

    const [afterSecond] = await db.select().from(sharedMedia).where(eq(sharedMedia.id, liveMediaId))
    expect(afterSecond?.revokedAt?.getTime()).toBe(firstRevokedAt)
  })

  test("DELETE with a mediaId from another project → 404", async () => {
    await seedTwoRows()
    const otherProjectId = await seedProject({
      name: "Other Project",
      publicKey: "rp_pk_SHAREDMEDIAOTHER0000000",
      createdBy: adminUserId,
    })

    const { status } = await apiFetch(
      `/api/projects/${otherProjectId}/shared-media/${liveMediaId}`,
      {
        method: "DELETE",
        headers: { cookie: ownerCookie },
      },
    )
    expect(status).toBe(404)

    await db.delete(projects).where(eq(projects.id, otherProjectId))
  })

  test("viewer-role member: GET and DELETE both → 403", async () => {
    await seedTwoRows()
    const { cookie: viewerCookie } = await seedMemberAtRole(
      "share-admin-viewer@example.com",
      projectId,
      "viewer",
    )

    const { status: getStatus } = await apiFetch(`/api/projects/${projectId}/shared-media`, {
      headers: { cookie: viewerCookie },
    })
    expect(getStatus).toBe(403)

    const { status: delStatus } = await apiFetch(
      `/api/projects/${projectId}/shared-media/${liveMediaId}`,
      { method: "DELETE", headers: { cookie: viewerCookie } },
    )
    expect(delStatus).toBe(403)
  })

  test("owner: PATCH shareLinksEnabled + shareRetentionDays → 200 and columns updated", async () => {
    const { status, body } = await apiFetch<ProjectDTO>(`/api/projects/${projectId}`, {
      method: "PATCH",
      headers: { cookie: ownerCookie },
      body: JSON.stringify({ shareLinksEnabled: false, shareRetentionDays: 7 }),
    })
    expect(status).toBe(200)
    expect((body as ProjectDTO).shareLinksEnabled).toBe(false)
    expect((body as ProjectDTO).shareRetentionDays).toBe(7)

    const [row] = await db.select().from(projects).where(eq(projects.id, projectId))
    expect(row?.shareLinksEnabled).toBe(false)
    expect(row?.shareRetentionDays).toBe(7)
  })

  test("manager PATCH project → 403 (owner gate holds)", async () => {
    const { cookie: managerCookie } = await seedMemberAtRole(
      "share-admin-manager@example.com",
      projectId,
      "manager",
    )
    const { status } = await apiFetch(`/api/projects/${projectId}`, {
      method: "PATCH",
      headers: { cookie: managerCookie },
      body: JSON.stringify({ shareLinksEnabled: false, shareRetentionDays: 7 }),
    })
    expect(status).toBe(403)
  })
})
