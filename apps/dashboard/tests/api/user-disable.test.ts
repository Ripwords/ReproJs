import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import { desc, eq, sql } from "drizzle-orm"
import { db } from "../../server/db"
import { session, verification } from "../../server/db/schema"
import { apiFetch, createUser, signIn, truncateDomain } from "../helpers"

setDefaultTimeout(30000)

const BASE_URL = process.env.TEST_BASE_URL ?? "http://localhost:3000"

/** Mint a magic link for `email` and return the raw verify response. */
async function clickMagicLink(email: string): Promise<Response> {
  const sent = await fetch(`${BASE_URL}/api/auth/sign-in/magic-link`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, callbackURL: "/" }),
  })
  expect(sent.status).toBe(200)
  const [row] = await db
    .select({ identifier: verification.identifier })
    .from(verification)
    .where(sql`${verification.value} LIKE ${`%"email":"${email}"%`}`)
    .orderBy(desc(verification.createdAt))
    .limit(1)
  const token = row?.identifier ?? ""
  return fetch(
    `${BASE_URL}/api/auth/magic-link/verify?token=${encodeURIComponent(token)}&callbackURL=/&errorCallbackURL=/auth/sign-in`,
    { redirect: "manual" },
  )
}

async function setStatus(adminCookie: string, userId: string, status: "active" | "disabled") {
  return apiFetch(`/api/users/${userId}`, {
    method: "PATCH",
    headers: { cookie: adminCookie },
    body: JSON.stringify({ status }),
  })
}

describe("disabling a user", () => {
  afterEach(async () => {
    await truncateDomain()
  })

  test("ends every session the user already had", async () => {
    await createUser("admin@example.com", "admin")
    const memberId = await createUser("member@example.com", "member")
    const adminCookie = await signIn("admin@example.com")
    const memberCookie = await signIn("member@example.com")

    const before = await apiFetch<{ user?: { email?: string } } | null>("/api/auth/get-session", {
      headers: { cookie: memberCookie },
    })
    expect(before.body?.user?.email).toBe("member@example.com")

    const { status } = await setStatus(adminCookie, memberId, "disabled")
    expect(status).toBe(200)

    const after = await apiFetch<{ user?: unknown } | null>("/api/auth/get-session", {
      headers: { cookie: memberCookie },
    })
    expect(after.body).toBeNull()
    const rows = await db.select().from(session).where(eq(session.userId, memberId))
    expect(rows).toHaveLength(0)
  })

  test("a disabled user's magic link lands on sign-in with account_disabled", async () => {
    await createUser("admin@example.com", "admin")
    const memberId = await createUser("member@example.com", "member")
    const adminCookie = await signIn("admin@example.com")
    await setStatus(adminCookie, memberId, "disabled")

    const res = await clickMagicLink("member@example.com")
    expect(res.status).toBe(302)
    const location = new URL(res.headers.get("location") ?? "", BASE_URL)
    expect(location.pathname).toBe("/auth/sign-in")
    expect(location.searchParams.get("error")).toBe("account_disabled")

    const rows = await db.select().from(session).where(eq(session.userId, memberId))
    expect(rows).toHaveLength(0)
  })

  test("the ended session reports why it ended, until the user is re-enabled", async () => {
    await createUser("admin@example.com", "admin")
    const memberId = await createUser("member@example.com", "member")
    const adminCookie = await signIn("admin@example.com")
    const memberCookie = await signIn("member@example.com")

    const live = await apiFetch<{ reason: string | null }>("/api/auth/session-ended", {
      headers: { cookie: memberCookie },
    })
    expect(live.body.reason).toBeNull()

    await setStatus(adminCookie, memberId, "disabled")
    const ended = await apiFetch<{ reason: string | null }>("/api/auth/session-ended", {
      headers: { cookie: memberCookie },
    })
    expect(ended.status).toBe(200)
    expect(ended.body.reason).toBe("account_disabled")

    // Re-enabled: the old cookie is still dead, but "your account is
    // disabled" would now be false.
    await setStatus(adminCookie, memberId, "active")
    const reenabled = await apiFetch<{ reason: string | null }>("/api/auth/session-ended", {
      headers: { cookie: memberCookie },
    })
    expect(reenabled.body.reason).toBeNull()
  })

  test("a disabled user mid-session is sent to sign-in with the reason, not a 403", async () => {
    await createUser("admin@example.com", "admin")
    const memberId = await createUser("member@example.com", "member")
    const adminCookie = await signIn("admin@example.com")
    const memberCookie = await signIn("member@example.com")
    await setStatus(adminCookie, memberId, "disabled")

    const res = await fetch(`${BASE_URL}/projects`, {
      headers: { cookie: memberCookie },
      redirect: "manual",
    })
    expect(res.status).toBe(302)
    const location = new URL(res.headers.get("location") ?? "", BASE_URL)
    expect(location.pathname).toBe("/auth/sign-in")
    expect(location.searchParams.get("error")).toBe("account_disabled")
    expect(location.searchParams.get("next")).toBe("/projects")

    const page = await (await fetch(location)).text()
    expect(page).toContain("Your account has been disabled")
  })

  test("session-ended reports nothing for a request with no session cookie", async () => {
    const res = await apiFetch<{ reason: string | null }>("/api/auth/session-ended")
    expect(res.status).toBe(200)
    expect(res.body.reason).toBeNull()
  })
})
