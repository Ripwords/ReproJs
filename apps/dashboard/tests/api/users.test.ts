import { afterEach, describe, expect, test, setDefaultTimeout } from "bun:test"
import { eq, sql } from "drizzle-orm"
import type { UserDTO } from "@reprojs/shared"
import { db } from "../../server/db"
import { user } from "../../server/db/schema"
import { apiFetch, createUser, signIn, truncateDomain } from "../helpers"

setDefaultTimeout(30000)

describe("users API", () => {
  afterEach(async () => {
    await truncateDomain()
  })

  test("GET /api/users requires admin", async () => {
    await createUser("member@example.com", "member")
    const cookie = await signIn("member@example.com")
    const { status } = await apiFetch("/api/users", { headers: { cookie } })
    expect(status).toBe(403)
  })

  test("admin can list users", async () => {
    await createUser("admin@example.com", "admin")
    await createUser("member@example.com", "member")
    const cookie = await signIn("admin@example.com")

    const { status, body } = await apiFetch<UserDTO[]>("/api/users", { headers: { cookie } })
    expect(status).toBe(200)
    expect((body as UserDTO[]).length).toBe(2)
  })

  test("admin can update user role", async () => {
    await createUser("admin@example.com", "admin")
    const memberId = await createUser("member@example.com", "member")
    const cookie = await signIn("admin@example.com")

    const { status, body } = await apiFetch<UserDTO>(`/api/users/${memberId}`, {
      method: "PATCH",
      headers: { cookie },
      body: JSON.stringify({ role: "admin" }),
    })
    expect(status).toBe(200)
    expect((body as UserDTO).role).toBe("admin")
  })

  test("admin invite stores email lowercased regardless of input casing", async () => {
    // REGRESSION (BLOCKER-3): POST /api/users used `body.email` verbatim,
    // so an admin inviting `MixedCase@Example.com` stored the raw-case
    // email. When signup_gated=true, better-auth's findUserByEmail
    // (which lowercases) then missed the mixed-case row on the
    // invitee's sign-in attempt, `create.before` fired, and the gate
    // rejected them — permanently locking out the legitimately invited
    // user. Every other code path in the repo already lowercases
    // (project-invitations, better-auth internals); the admin-invite
    // path was the outlier.
    await createUser("admin@example.com", "admin")
    const cookie = await signIn("admin@example.com")

    const { status } = await apiFetch("/api/users", {
      method: "POST",
      headers: { cookie },
      body: JSON.stringify({
        email: "MixedCase@Example.com",
        role: "member",
      }),
    })
    expect(status).toBe(200)

    const [row] = await db.select().from(user).where(eq(user.email, "mixedcase@example.com"))
    expect(row).toBeDefined()
    expect(row?.email).toBe("mixedcase@example.com")

    // And no raw-case row snuck through:
    const [rawCase] = await db.select().from(user).where(eq(user.email, "MixedCase@Example.com"))
    expect(rawCase).toBeUndefined()
  })

  test("admin invite honours the domain allowlist even when sign-up is open", async () => {
    // Sign-in enforces allowed_email_domains whether or not signup_gated is
    // on, so an off-list invite used to create an `invited` row the invitee
    // could never sign in to — they just bounced to domain_not_allowed.
    await createUser("admin@example.com", "admin")
    const cookie = await signIn("admin@example.com")
    await db.execute(
      sql`UPDATE app_settings SET signup_gated = false, allowed_email_domains = '{"example.com"}'::text[] WHERE id = 1`,
    )

    const { status, body } = await apiFetch<{ statusMessage?: string }>("/api/users", {
      method: "POST",
      headers: { cookie },
      body: JSON.stringify({ email: "outsider@other.com", role: "member" }),
    })
    expect(status).toBe(400)
    expect(body.statusMessage).toContain("other.com")

    const [row] = await db.select().from(user).where(eq(user.email, "outsider@other.com"))
    expect(row).toBeUndefined()
  })

  test("reactivating an invitee who never signed in puts them back to invited", async () => {
    await createUser("admin@example.com", "admin")
    const cookie = await signIn("admin@example.com")
    const invite = await apiFetch<UserDTO>("/api/users", {
      method: "POST",
      headers: { cookie },
      body: JSON.stringify({ email: "pending@example.com", role: "member" }),
    })
    const inviteeId = (invite.body as UserDTO).id

    await apiFetch(`/api/users/${inviteeId}`, {
      method: "PATCH",
      headers: { cookie },
      body: JSON.stringify({ status: "disabled" }),
    })
    const reactivated = await apiFetch<UserDTO>(`/api/users/${inviteeId}`, {
      method: "PATCH",
      headers: { cookie },
      body: JSON.stringify({ status: "active" }),
    })
    expect(reactivated.status).toBe(200)
    expect((reactivated.body as UserDTO).status).toBe("invited")
  })

  test("reactivating a user who has signed in before makes them active", async () => {
    await createUser("admin@example.com", "admin")
    const memberId = await createUser("member@example.com", "member")
    await signIn("member@example.com")
    const cookie = await signIn("admin@example.com")

    await apiFetch(`/api/users/${memberId}`, {
      method: "PATCH",
      headers: { cookie },
      body: JSON.stringify({ status: "disabled" }),
    })
    const reactivated = await apiFetch<UserDTO>(`/api/users/${memberId}`, {
      method: "PATCH",
      headers: { cookie },
      body: JSON.stringify({ status: "active" }),
    })
    expect((reactivated.body as UserDTO).status).toBe("active")
  })

  test("a disabled admin does not count toward the last-admin guard", async () => {
    // A disabled admin can't sign in, so demoting or disabling the only
    // *active* admin locks everyone out of user management.
    const activeId = await createUser("active-admin@example.com", "admin")
    const disabledId = await createUser("disabled-admin@example.com", "admin")
    await db.update(user).set({ status: "disabled" }).where(eq(user.id, disabledId))
    const cookie = await signIn("active-admin@example.com")

    const demote = await apiFetch(`/api/users/${activeId}`, {
      method: "PATCH",
      headers: { cookie },
      body: JSON.stringify({ role: "member" }),
    })
    expect(demote.status).toBe(409)

    const disable = await apiFetch(`/api/users/${activeId}`, {
      method: "PATCH",
      headers: { cookie },
      body: JSON.stringify({ status: "disabled" }),
    })
    expect(disable.status).toBe(409)

    const [row] = await db.select().from(user).where(eq(user.id, activeId))
    expect(row?.role).toBe("admin")
    expect(row?.status).toBe("active")
  })

  test("concurrent demotions of the last two admins leave one admin standing", async () => {
    const aId = await createUser("a-admin@example.com", "admin")
    const bId = await createUser("b-admin@example.com", "admin")
    const cookie = await signIn("a-admin@example.com")

    const demote = (id: string) =>
      apiFetch(`/api/users/${id}`, {
        method: "PATCH",
        headers: { cookie },
        body: JSON.stringify({ role: "member" }),
      })
    const results = await Promise.all([demote(aId), demote(bId)])
    expect(results.map((r) => r.status).toSorted()).toEqual([200, 409])

    const admins = await db.select().from(user).where(eq(user.role, "admin"))
    expect(admins).toHaveLength(1)
  })

  test("cannot demote the last admin", async () => {
    const adminId = await createUser("admin@example.com", "admin")
    const cookie = await signIn("admin@example.com")

    const { status } = await apiFetch(`/api/users/${adminId}`, {
      method: "PATCH",
      headers: { cookie },
      body: JSON.stringify({ role: "member" }),
    })
    expect(status).toBe(409)
  })
})
