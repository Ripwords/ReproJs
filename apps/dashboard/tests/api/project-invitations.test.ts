import { afterEach, describe, expect, test, setDefaultTimeout } from "bun:test"
import type { ProjectDTO, ProjectInvitationDTO } from "@reprojs/shared"
import { eq, sql } from "drizzle-orm"
import { db } from "../../server/db"
import { projectInvitations, user } from "../../server/db/schema"
import { apiFetch, createUser, signIn, truncateDomain } from "../helpers"

setDefaultTimeout(30000)

describe("project invitations API", () => {
  afterEach(async () => {
    await truncateDomain()
  })

  test("owner can invite a brand-new email — creates invited user row and pending invite", async () => {
    await createUser("owner@example.com", "admin")
    const ownerCookie = await signIn("owner@example.com")

    const { body: project } = await apiFetch<ProjectDTO>("/api/projects", {
      method: "POST",
      headers: { cookie: ownerCookie },
      body: JSON.stringify({ name: "Test Project" }),
    })
    const projectId = (project as ProjectDTO).id

    const { status, body } = await apiFetch<ProjectInvitationDTO>(
      `/api/projects/${projectId}/invitations`,
      {
        method: "POST",
        headers: { cookie: ownerCookie },
        body: JSON.stringify({ email: "new@example.com", role: "developer" }),
      },
    )

    expect(status).toBe(201)
    const invite = body as ProjectInvitationDTO
    expect(invite.email).toBe("new@example.com")
    expect(invite.role).toBe("developer")
    expect(invite.status).toBe("pending")

    const [invitedUser] = await db.select().from(user).where(eq(user.email, "new@example.com"))
    expect(invitedUser?.status).toBe("invited")

    const rows = await db
      .select()
      .from(projectInvitations)
      .where(eq(projectInvitations.email, "new@example.com"))
    expect(rows).toHaveLength(1)
    expect(rows[0]?.token).toMatch(/^[0-9a-f]{64}$/)
  })

  test("inviting an already-active user does not create a new user row", async () => {
    await createUser("owner@example.com", "admin")
    await createUser("alice@example.com", "member")
    const ownerCookie = await signIn("owner@example.com")

    const { body: project } = await apiFetch<ProjectDTO>("/api/projects", {
      method: "POST",
      headers: { cookie: ownerCookie },
      body: JSON.stringify({ name: "Test Project" }),
    })
    const projectId = (project as ProjectDTO).id

    const { status } = await apiFetch(`/api/projects/${projectId}/invitations`, {
      method: "POST",
      headers: { cookie: ownerCookie },
      body: JSON.stringify({ email: "alice@example.com", role: "viewer" }),
    })
    expect(status).toBe(201)

    const rows = await db.select().from(user).where(eq(user.email, "alice@example.com"))
    expect(rows).toHaveLength(1)
    expect(rows[0]?.status).toBe("active") // untouched
  })

  test("duplicate pending invite for same project+email returns 409", async () => {
    await createUser("owner@example.com", "admin")
    const ownerCookie = await signIn("owner@example.com")

    const { body: project } = await apiFetch<ProjectDTO>("/api/projects", {
      method: "POST",
      headers: { cookie: ownerCookie },
      body: JSON.stringify({ name: "Test Project" }),
    })
    const projectId = (project as ProjectDTO).id

    await apiFetch(`/api/projects/${projectId}/invitations`, {
      method: "POST",
      headers: { cookie: ownerCookie },
      body: JSON.stringify({ email: "bob@example.com", role: "developer" }),
    })
    const { status } = await apiFetch(`/api/projects/${projectId}/invitations`, {
      method: "POST",
      headers: { cookie: ownerCookie },
      body: JSON.stringify({ email: "bob@example.com", role: "developer" }),
    })
    expect(status).toBe(409)
  })

  test("inviting an email that is already a project member returns 409", async () => {
    await createUser("owner@example.com", "admin")
    await createUser("member@example.com", "member")
    const ownerCookie = await signIn("owner@example.com")

    const { body: project } = await apiFetch<ProjectDTO>("/api/projects", {
      method: "POST",
      headers: { cookie: ownerCookie },
      body: JSON.stringify({ name: "Test Project" }),
    })
    const projectId = (project as ProjectDTO).id

    // Add directly via legacy endpoint to prime membership.
    await apiFetch(`/api/projects/${projectId}/members`, {
      method: "POST",
      headers: { cookie: ownerCookie },
      body: JSON.stringify({ email: "member@example.com", role: "viewer" }),
    })

    const { status } = await apiFetch(`/api/projects/${projectId}/invitations`, {
      method: "POST",
      headers: { cookie: ownerCookie },
      body: JSON.stringify({ email: "member@example.com", role: "developer" }),
    })
    expect(status).toBe(409)
  })

  test("domain allowlist blocks invites to off-allowlist domains", async () => {
    await createUser("owner@example.com", "admin")
    const ownerCookie = await signIn("owner@example.com")
    const { body: project } = await apiFetch<ProjectDTO>("/api/projects", {
      method: "POST",
      headers: { cookie: ownerCookie },
      body: JSON.stringify({ name: "Test Project" }),
    })
    const projectId = (project as ProjectDTO).id

    await db.execute(
      sql`UPDATE app_settings SET signup_gated = true, allowed_email_domains = '{"example.com"}'::text[] WHERE id = 1`,
    )

    const { status } = await apiFetch(`/api/projects/${projectId}/invitations`, {
      method: "POST",
      headers: { cookie: ownerCookie },
      body: JSON.stringify({ email: "outsider@other.com", role: "developer" }),
    })
    expect(status).toBe(400)
  })

  test("domain allowlist blocks invites even when sign-up is open", async () => {
    // Sign-in enforces the allowlist regardless of signup_gated, so an
    // off-list invite would strand the invitee on domain_not_allowed.
    await createUser("owner@example.com", "admin")
    const ownerCookie = await signIn("owner@example.com")
    const { body: project } = await apiFetch<ProjectDTO>("/api/projects", {
      method: "POST",
      headers: { cookie: ownerCookie },
      body: JSON.stringify({ name: "Test Project" }),
    })
    const projectId = (project as ProjectDTO).id

    await db.execute(
      sql`UPDATE app_settings SET signup_gated = false, allowed_email_domains = '{"example.com"}'::text[] WHERE id = 1`,
    )

    const { status, body } = await apiFetch<{ statusMessage?: string }>(
      `/api/projects/${projectId}/invitations`,
      {
        method: "POST",
        headers: { cookie: ownerCookie },
        body: JSON.stringify({ email: "outsider@other.com", role: "developer" }),
      },
    )
    expect(status).toBe(400)
    expect(body.statusMessage).toContain("other.com")

    const [row] = await db.select().from(user).where(eq(user.email, "outsider@other.com"))
    expect(row).toBeUndefined()
  })

  test("non-owner cannot create an invitation", async () => {
    await createUser("owner@example.com", "admin")
    await createUser("viewer@example.com", "member")
    const ownerCookie = await signIn("owner@example.com")
    const viewerCookie = await signIn("viewer@example.com")

    const { body: project } = await apiFetch<ProjectDTO>("/api/projects", {
      method: "POST",
      headers: { cookie: ownerCookie },
      body: JSON.stringify({ name: "Test Project" }),
    })
    const projectId = (project as ProjectDTO).id

    await apiFetch(`/api/projects/${projectId}/members`, {
      method: "POST",
      headers: { cookie: ownerCookie },
      body: JSON.stringify({ email: "viewer@example.com", role: "viewer" }),
    })

    const { status } = await apiFetch(`/api/projects/${projectId}/invitations`, {
      method: "POST",
      headers: { cookie: viewerCookie },
      body: JSON.stringify({ email: "x@example.com", role: "developer" }),
    })
    expect(status).toBe(403)
  })

  test("owner can list only pending invitations for a project", async () => {
    await createUser("owner@example.com", "admin")
    const ownerCookie = await signIn("owner@example.com")

    const { body: project } = await apiFetch<ProjectDTO>("/api/projects", {
      method: "POST",
      headers: { cookie: ownerCookie },
      body: JSON.stringify({ name: "Test Project" }),
    })
    const projectId = (project as ProjectDTO).id

    await apiFetch(`/api/projects/${projectId}/invitations`, {
      method: "POST",
      headers: { cookie: ownerCookie },
      body: JSON.stringify({ email: "a@example.com", role: "viewer" }),
    })
    await apiFetch(`/api/projects/${projectId}/invitations`, {
      method: "POST",
      headers: { cookie: ownerCookie },
      body: JSON.stringify({ email: "b@example.com", role: "developer" }),
    })

    const { status, body } = await apiFetch<ProjectInvitationDTO[]>(
      `/api/projects/${projectId}/invitations`,
      { headers: { cookie: ownerCookie } },
    )
    expect(status).toBe(200)
    const list = body as ProjectInvitationDTO[]
    expect(list).toHaveLength(2)
    expect(list.map((i) => i.email).toSorted()).toEqual(["a@example.com", "b@example.com"])
    expect(list.every((i) => i.status === "pending")).toBe(true)
  })

  test("owner can revoke a pending invitation", async () => {
    await createUser("owner@example.com", "admin")
    const ownerCookie = await signIn("owner@example.com")
    const { body: project } = await apiFetch<ProjectDTO>("/api/projects", {
      method: "POST",
      headers: { cookie: ownerCookie },
      body: JSON.stringify({ name: "Test Project" }),
    })
    const projectId = (project as ProjectDTO).id

    const { body: created } = await apiFetch<ProjectInvitationDTO>(
      `/api/projects/${projectId}/invitations`,
      {
        method: "POST",
        headers: { cookie: ownerCookie },
        body: JSON.stringify({ email: "x@example.com", role: "developer" }),
      },
    )
    const invitationId = (created as ProjectInvitationDTO).id

    const { status } = await apiFetch(`/api/projects/${projectId}/invitations/${invitationId}`, {
      method: "DELETE",
      headers: { cookie: ownerCookie },
    })
    expect(status).toBe(200)

    const [row] = await db
      .select()
      .from(projectInvitations)
      .where(eq(projectInvitations.id, invitationId))
    expect(row?.status).toBe("revoked")
  })

  test("owner can resend a pending invitation — bumps expiresAt", async () => {
    await createUser("owner@example.com", "admin")
    const ownerCookie = await signIn("owner@example.com")
    const { body: project } = await apiFetch<ProjectDTO>("/api/projects", {
      method: "POST",
      headers: { cookie: ownerCookie },
      body: JSON.stringify({ name: "Test Project" }),
    })
    const projectId = (project as ProjectDTO).id

    const { body: created } = await apiFetch<ProjectInvitationDTO>(
      `/api/projects/${projectId}/invitations`,
      {
        method: "POST",
        headers: { cookie: ownerCookie },
        body: JSON.stringify({ email: "resend@example.com", role: "developer" }),
      },
    )
    const invitationId = (created as ProjectInvitationDTO).id
    const originalExpiry = new Date((created as ProjectInvitationDTO).expiresAt).getTime()

    // Wait a tick so the bumped timestamp differs.
    await new Promise((r) => setTimeout(r, 25))

    const { status } = await apiFetch(
      `/api/projects/${projectId}/invitations/${invitationId}/resend`,
      { method: "POST", headers: { cookie: ownerCookie } },
    )
    expect(status).toBe(200)

    const [row] = await db
      .select()
      .from(projectInvitations)
      .where(eq(projectInvitations.id, invitationId))
    expect(row?.expiresAt.getTime()).toBeGreaterThan(originalExpiry)
  })

  test("resending a non-pending invitation returns 409", async () => {
    await createUser("owner@example.com", "admin")
    const ownerCookie = await signIn("owner@example.com")
    const { body: project } = await apiFetch<ProjectDTO>("/api/projects", {
      method: "POST",
      headers: { cookie: ownerCookie },
      body: JSON.stringify({ name: "Test Project" }),
    })
    const projectId = (project as ProjectDTO).id

    const { body: created } = await apiFetch<ProjectInvitationDTO>(
      `/api/projects/${projectId}/invitations`,
      {
        method: "POST",
        headers: { cookie: ownerCookie },
        body: JSON.stringify({ email: "revoke@example.com", role: "developer" }),
      },
    )
    const invitationId = (created as ProjectInvitationDTO).id
    await apiFetch(`/api/projects/${projectId}/invitations/${invitationId}`, {
      method: "DELETE",
      headers: { cookie: ownerCookie },
    })
    const { status } = await apiFetch(
      `/api/projects/${projectId}/invitations/${invitationId}/resend`,
      { method: "POST", headers: { cookie: ownerCookie } },
    )
    expect(status).toBe(409)
  })

  test("authenticated invitee can fetch invitation detail by token", async () => {
    await createUser("owner@example.com", "admin")
    const ownerCookie = await signIn("owner@example.com")
    const { body: project } = await apiFetch<ProjectDTO>("/api/projects", {
      method: "POST",
      headers: { cookie: ownerCookie },
      body: JSON.stringify({ name: "Detail Project" }),
    })
    const projectId = (project as ProjectDTO).id

    await apiFetch(`/api/projects/${projectId}/invitations`, {
      method: "POST",
      headers: { cookie: ownerCookie },
      body: JSON.stringify({ email: "detail@example.com", role: "viewer" }),
    })
    const [row] = await db
      .select()
      .from(projectInvitations)
      .where(eq(projectInvitations.email, "detail@example.com"))
    const token = row!.token

    // Brand-new user was pre-created; sign them in.
    const inviteeCookie = await signIn("detail@example.com")

    const { status, body } = await apiFetch<{
      token: string
      projectName: string
      role: string
      email: string
    }>(`/api/invitations/${token}`, { headers: { cookie: inviteeCookie } })

    expect(status).toBe(200)
    expect(body).toMatchObject({
      token,
      projectName: "Detail Project",
      role: "viewer",
      email: "detail@example.com",
    })
  })

  test("GET invitation detail with mismatched session email returns 403", async () => {
    await createUser("owner@example.com", "admin")
    await createUser("intruder@example.com", "member")
    const ownerCookie = await signIn("owner@example.com")
    const { body: project } = await apiFetch<ProjectDTO>("/api/projects", {
      method: "POST",
      headers: { cookie: ownerCookie },
      body: JSON.stringify({ name: "P" }),
    })
    const projectId = (project as ProjectDTO).id
    await apiFetch(`/api/projects/${projectId}/invitations`, {
      method: "POST",
      headers: { cookie: ownerCookie },
      body: JSON.stringify({ email: "victim@example.com", role: "viewer" }),
    })
    const [row] = await db
      .select()
      .from(projectInvitations)
      .where(eq(projectInvitations.email, "victim@example.com"))
    const intruderCookie = await signIn("intruder@example.com")
    const { status } = await apiFetch(`/api/invitations/${row!.token}`, {
      headers: { cookie: intruderCookie },
    })
    expect(status).toBe(403)
  })

  test("unauthenticated request to invitation detail returns 401", async () => {
    await createUser("owner@example.com", "admin")
    const ownerCookie = await signIn("owner@example.com")
    const { body: project } = await apiFetch<ProjectDTO>("/api/projects", {
      method: "POST",
      headers: { cookie: ownerCookie },
      body: JSON.stringify({ name: "P" }),
    })
    const projectId = (project as ProjectDTO).id
    await apiFetch(`/api/projects/${projectId}/invitations`, {
      method: "POST",
      headers: { cookie: ownerCookie },
      body: JSON.stringify({ email: "anon@example.com", role: "viewer" }),
    })
    const [row] = await db
      .select()
      .from(projectInvitations)
      .where(eq(projectInvitations.email, "anon@example.com"))
    const { status } = await apiFetch(`/api/invitations/${row!.token}`)
    expect(status).toBe(401)
  })

  test("GET invitation detail for revoked invite returns 409", async () => {
    await createUser("owner@example.com", "admin")
    const ownerCookie = await signIn("owner@example.com")
    const { body: project } = await apiFetch<ProjectDTO>("/api/projects", {
      method: "POST",
      headers: { cookie: ownerCookie },
      body: JSON.stringify({ name: "P" }),
    })
    const projectId = (project as ProjectDTO).id
    const { body: created } = await apiFetch<ProjectInvitationDTO>(
      `/api/projects/${projectId}/invitations`,
      {
        method: "POST",
        headers: { cookie: ownerCookie },
        body: JSON.stringify({ email: "revoked-get@example.com", role: "viewer" }),
      },
    )
    const invitationId = (created as ProjectInvitationDTO).id
    await apiFetch(`/api/projects/${projectId}/invitations/${invitationId}`, {
      method: "DELETE",
      headers: { cookie: ownerCookie },
    })
    const [row] = await db
      .select()
      .from(projectInvitations)
      .where(eq(projectInvitations.id, invitationId))
    const inviteeCookie = await signIn("revoked-get@example.com")
    const { status } = await apiFetch(`/api/invitations/${row!.token}`, {
      headers: { cookie: inviteeCookie },
    })
    expect(status).toBe(409)
  })

  test("GET invitation detail for time-expired invite flips status and returns 409", async () => {
    await createUser("owner@example.com", "admin")
    const ownerCookie = await signIn("owner@example.com")
    const { body: project } = await apiFetch<ProjectDTO>("/api/projects", {
      method: "POST",
      headers: { cookie: ownerCookie },
      body: JSON.stringify({ name: "P" }),
    })
    const projectId = (project as ProjectDTO).id
    await apiFetch(`/api/projects/${projectId}/invitations`, {
      method: "POST",
      headers: { cookie: ownerCookie },
      body: JSON.stringify({ email: "expire-get@example.com", role: "viewer" }),
    })
    const [row] = await db
      .select()
      .from(projectInvitations)
      .where(eq(projectInvitations.email, "expire-get@example.com"))
    await db
      .update(projectInvitations)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(projectInvitations.id, row!.id))
    const inviteeCookie = await signIn("expire-get@example.com")
    const { status } = await apiFetch(`/api/invitations/${row!.token}`, {
      headers: { cookie: inviteeCookie },
    })
    expect(status).toBe(409)
    const [after] = await db
      .select()
      .from(projectInvitations)
      .where(eq(projectInvitations.id, row!.id))
    expect(after?.status).toBe("expired")
  })

  test("accepting a valid invitation inserts into project_members and marks accepted", async () => {
    await createUser("owner@example.com", "admin")
    const ownerCookie = await signIn("owner@example.com")
    const { body: project } = await apiFetch<ProjectDTO>("/api/projects", {
      method: "POST",
      headers: { cookie: ownerCookie },
      body: JSON.stringify({ name: "Accept Project" }),
    })
    const projectId = (project as ProjectDTO).id

    await apiFetch(`/api/projects/${projectId}/invitations`, {
      method: "POST",
      headers: { cookie: ownerCookie },
      body: JSON.stringify({ email: "joiner@example.com", role: "developer" }),
    })
    const [row] = await db
      .select()
      .from(projectInvitations)
      .where(eq(projectInvitations.email, "joiner@example.com"))
    const token = row!.token
    const inviteeCookie = await signIn("joiner@example.com")

    const { status, body } = await apiFetch<{ projectId: string; role: string }>(
      `/api/invitations/${token}/accept`,
      { method: "POST", headers: { cookie: inviteeCookie } },
    )
    expect(status).toBe(200)
    expect(body).toMatchObject({ projectId, role: "developer" })

    const [updated] = await db
      .select()
      .from(projectInvitations)
      .where(eq(projectInvitations.token, token))
    expect(updated?.status).toBe("accepted")
    expect(updated?.acceptedAt).toBeInstanceOf(Date)
  })

  test("accepting with a mismatched session email returns 403", async () => {
    await createUser("owner@example.com", "admin")
    await createUser("other@example.com", "member")
    const ownerCookie = await signIn("owner@example.com")
    const { body: project } = await apiFetch<ProjectDTO>("/api/projects", {
      method: "POST",
      headers: { cookie: ownerCookie },
      body: JSON.stringify({ name: "P" }),
    })
    const projectId = (project as ProjectDTO).id

    await apiFetch(`/api/projects/${projectId}/invitations`, {
      method: "POST",
      headers: { cookie: ownerCookie },
      body: JSON.stringify({ email: "target@example.com", role: "viewer" }),
    })
    const [row] = await db
      .select()
      .from(projectInvitations)
      .where(eq(projectInvitations.email, "target@example.com"))
    const token = row!.token

    const otherCookie = await signIn("other@example.com")
    const { status } = await apiFetch(`/api/invitations/${token}/accept`, {
      method: "POST",
      headers: { cookie: otherCookie },
    })
    expect(status).toBe(403)
  })

  test("accepting a revoked invitation returns 409", async () => {
    await createUser("owner@example.com", "admin")
    const ownerCookie = await signIn("owner@example.com")
    const { body: project } = await apiFetch<ProjectDTO>("/api/projects", {
      method: "POST",
      headers: { cookie: ownerCookie },
      body: JSON.stringify({ name: "P" }),
    })
    const projectId = (project as ProjectDTO).id

    const { body: created } = await apiFetch<ProjectInvitationDTO>(
      `/api/projects/${projectId}/invitations`,
      {
        method: "POST",
        headers: { cookie: ownerCookie },
        body: JSON.stringify({ email: "revoked@example.com", role: "viewer" }),
      },
    )
    const invitationId = (created as ProjectInvitationDTO).id
    await apiFetch(`/api/projects/${projectId}/invitations/${invitationId}`, {
      method: "DELETE",
      headers: { cookie: ownerCookie },
    })

    const [row] = await db
      .select()
      .from(projectInvitations)
      .where(eq(projectInvitations.id, invitationId))
    const inviteeCookie = await signIn("revoked@example.com")

    const { status } = await apiFetch(`/api/invitations/${row!.token}/accept`, {
      method: "POST",
      headers: { cookie: inviteeCookie },
    })
    expect(status).toBe(409)
  })

  test("accepting an expired invitation flips status to expired and returns 409", async () => {
    await createUser("owner@example.com", "admin")
    const ownerCookie = await signIn("owner@example.com")
    const { body: project } = await apiFetch<ProjectDTO>("/api/projects", {
      method: "POST",
      headers: { cookie: ownerCookie },
      body: JSON.stringify({ name: "P" }),
    })
    const projectId = (project as ProjectDTO).id

    await apiFetch(`/api/projects/${projectId}/invitations`, {
      method: "POST",
      headers: { cookie: ownerCookie },
      body: JSON.stringify({ email: "expired@example.com", role: "viewer" }),
    })
    const [row] = await db
      .select()
      .from(projectInvitations)
      .where(eq(projectInvitations.email, "expired@example.com"))

    // Backdate expiresAt to force an expired condition.
    await db
      .update(projectInvitations)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(projectInvitations.id, row!.id))

    const inviteeCookie = await signIn("expired@example.com")
    const { status } = await apiFetch(`/api/invitations/${row!.token}/accept`, {
      method: "POST",
      headers: { cookie: inviteeCookie },
    })
    expect(status).toBe(409)

    const [after] = await db
      .select()
      .from(projectInvitations)
      .where(eq(projectInvitations.id, row!.id))
    expect(after?.status).toBe("expired")
  })

  test("accepting twice is idempotent — second call is a no-op 200", async () => {
    await createUser("owner@example.com", "admin")
    const ownerCookie = await signIn("owner@example.com")
    const { body: project } = await apiFetch<ProjectDTO>("/api/projects", {
      method: "POST",
      headers: { cookie: ownerCookie },
      body: JSON.stringify({ name: "P" }),
    })
    const projectId = (project as ProjectDTO).id

    await apiFetch(`/api/projects/${projectId}/invitations`, {
      method: "POST",
      headers: { cookie: ownerCookie },
      body: JSON.stringify({ email: "dup@example.com", role: "viewer" }),
    })
    const [row] = await db
      .select()
      .from(projectInvitations)
      .where(eq(projectInvitations.email, "dup@example.com"))
    const cookie = await signIn("dup@example.com")

    const first = await apiFetch(`/api/invitations/${row!.token}/accept`, {
      method: "POST",
      headers: { cookie },
    })
    expect(first.status).toBe(200)
    const second = await apiFetch(`/api/invitations/${row!.token}/accept`, {
      method: "POST",
      headers: { cookie },
    })
    expect(second.status).toBe(200)
  })

  test("invitee can decline — status goes to revoked, no membership", async () => {
    await createUser("owner@example.com", "admin")
    const ownerCookie = await signIn("owner@example.com")
    const { body: project } = await apiFetch<ProjectDTO>("/api/projects", {
      method: "POST",
      headers: { cookie: ownerCookie },
      body: JSON.stringify({ name: "P" }),
    })
    const projectId = (project as ProjectDTO).id

    await apiFetch(`/api/projects/${projectId}/invitations`, {
      method: "POST",
      headers: { cookie: ownerCookie },
      body: JSON.stringify({ email: "nope@example.com", role: "viewer" }),
    })
    const [row] = await db
      .select()
      .from(projectInvitations)
      .where(eq(projectInvitations.email, "nope@example.com"))
    const cookie = await signIn("nope@example.com")

    const { status } = await apiFetch(`/api/invitations/${row!.token}/decline`, {
      method: "POST",
      headers: { cookie },
    })
    expect(status).toBe(204)

    const [after] = await db
      .select()
      .from(projectInvitations)
      .where(eq(projectInvitations.id, row!.id))
    expect(after?.status).toBe("revoked")
  })

  test("declining with a mismatched session email returns 403", async () => {
    await createUser("owner@example.com", "admin")
    await createUser("intruder@example.com", "member")
    const ownerCookie = await signIn("owner@example.com")
    const { body: project } = await apiFetch<ProjectDTO>("/api/projects", {
      method: "POST",
      headers: { cookie: ownerCookie },
      body: JSON.stringify({ name: "P" }),
    })
    const projectId = (project as ProjectDTO).id
    await apiFetch(`/api/projects/${projectId}/invitations`, {
      method: "POST",
      headers: { cookie: ownerCookie },
      body: JSON.stringify({ email: "target-decline@example.com", role: "viewer" }),
    })
    const [row] = await db
      .select()
      .from(projectInvitations)
      .where(eq(projectInvitations.email, "target-decline@example.com"))
    const intruderCookie = await signIn("intruder@example.com")
    const { status } = await apiFetch(`/api/invitations/${row!.token}/decline`, {
      method: "POST",
      headers: { cookie: intruderCookie },
    })
    expect(status).toBe(403)
  })
})
