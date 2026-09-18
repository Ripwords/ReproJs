import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import { desc, eq, sql } from "drizzle-orm"
import { db } from "../../server/db"
import { verification } from "../../server/db/schema"
import { apiFetch, createUser, truncateDomain } from "../helpers"

setDefaultTimeout(30000)

const BASE_URL = process.env.TEST_BASE_URL ?? "http://localhost:3000"

// Mail gateways (Microsoft 365 Safe Links, Proofpoint, antivirus scanners)
// GET every link in an incoming email before the person sees it. The magic
// link is single-use, so the emailed URL must be safe to GET any number of
// times; only the person pressing "Sign in" may spend the token.

async function requestLink(email: string): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/auth/sign-in/magic-link`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, callbackURL: "/" }),
  })
  expect(res.status).toBe(200)
  const [row] = await db
    .select({ identifier: verification.identifier })
    .from(verification)
    .where(sql`${verification.value} LIKE ${`%"email":"${email}"%`}`)
    .orderBy(desc(verification.createdAt))
    .limit(1)
  if (!row) throw new Error(`no verification row for ${email}`)
  return row.identifier
}

async function verificationRow(token: string) {
  const [row] = await db.select().from(verification).where(eq(verification.identifier, token))
  return row
}

describe("magic-link landing page", () => {
  afterEach(async () => {
    await truncateDomain()
  })

  test("GETting the emailed link does not spend the token", async () => {
    await createUser("scanned@example.com")
    const token = await requestLink("scanned@example.com")
    const before = await verificationRow(token)

    const landing = `${BASE_URL}/auth/verify?token=${encodeURIComponent(token)}&callbackURL=%2F`
    // Scanners, then the person's own browser, all load the page.
    const loads = await Promise.all(
      [1, 2, 3].map(async () => {
        const res = await fetch(landing, { redirect: "manual" })
        return { status: res.status, cookie: res.headers.get("set-cookie"), html: await res.text() }
      }),
    )
    for (const load of loads) {
      expect(load.status).toBe(200)
      expect(load.cookie ?? "").not.toContain("session_token")
      expect(load.html).toContain("Finish signing in")
    }

    const after = await verificationRow(token)
    expect(after).toBeDefined()
    expect(after?.value).toBe(before?.value ?? "")
  })

  test("the verify request the button sends still signs the person in once", async () => {
    await createUser("clicker@example.com")
    const token = await requestLink("clicker@example.com")

    // The scanner's prefetch.
    await fetch(`${BASE_URL}/auth/verify?token=${encodeURIComponent(token)}&callbackURL=%2F`, {
      redirect: "manual",
    })

    const verify = await fetch(
      `${BASE_URL}/api/auth/magic-link/verify?token=${encodeURIComponent(token)}&callbackURL=%2F&errorCallbackURL=%2Fauth%2Fsign-in`,
      { redirect: "manual" },
    )
    expect(verify.status).toBe(302)
    expect(verify.headers.get("location") ?? "").not.toContain("error=")
    const cookie = (verify.headers.get("set-cookie") ?? "").split(";")[0] ?? ""
    expect(cookie).toContain("session_token")

    const me = await apiFetch<{ user?: { email?: string } }>("/api/auth/get-session", {
      headers: { cookie },
    })
    expect(me.body.user?.email).toBe("clicker@example.com")
  })

  test("a link without a token says so instead of offering a dead button", async () => {
    const res = await fetch(`${BASE_URL}/auth/verify`, { redirect: "manual" })
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain("This sign-in link is incomplete")
  })
})
