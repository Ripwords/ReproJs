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
