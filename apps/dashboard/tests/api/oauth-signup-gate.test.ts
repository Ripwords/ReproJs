import { afterAll, afterEach, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test"

setDefaultTimeout(30000)

/**
 * OAuth callback × workspace gates.
 *
 * The dev server can't be pointed at a fake GitHub (its provider config is
 * baked in at boot and it talks to github.com), so this suite drives
 * better-auth in-process instead: it imports the real `auth` instance from
 * server/lib/auth.ts with a GitHub provider configured, stubs the two
 * github.com endpoints the provider calls, and walks the same two requests a
 * browser makes — POST /sign-in/social, then GET /callback/github.
 *
 * Env must be set before server/lib/env.ts is first imported (it parses once),
 * so every project import below is dynamic.
 */
process.env.GITHUB_CLIENT_ID ||= "test-github-client-id"
process.env.GITHUB_CLIENT_SECRET ||= "test-github-client-secret"

const { auth } = await import("../../server/lib/auth")
const { env } = await import("../../server/lib/env")
const { db } = await import("../../server/db")
const { sql } = await import("drizzle-orm")
const { createUser, eq, truncateDomain, user } = await import("../helpers")

const ORIGIN = new URL(env.BETTER_AUTH_URL).origin

interface FakeGithubUser {
  id: number
  email: string
}
let githubUser: FakeGithubUser = { id: 1, email: "nobody@example.com" }

const realFetch = globalThis.fetch
function fakeGithubFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = input instanceof Request ? input.url : input.toString()
  if (url.startsWith("https://github.com/login/oauth/access_token")) {
    return Promise.resolve(
      Response.json({ access_token: "gho_test", token_type: "bearer", scope: "read:user" }),
    )
  }
  if (url === "https://api.github.com/user") {
    return Promise.resolve(
      Response.json({
        id: githubUser.id,
        login: `gh${githubUser.id}`,
        name: "GitHub User",
        email: githubUser.email,
        avatar_url: null,
      }),
    )
  }
  if (url === "https://api.github.com/user/emails") {
    return Promise.resolve(
      Response.json([{ email: githubUser.email, primary: true, verified: true }]),
    )
  }
  return realFetch(input, init)
}

beforeAll(() => {
  globalThis.fetch = Object.assign(fakeGithubFetch, { preconnect: realFetch.preconnect })
})
afterAll(() => {
  globalThis.fetch = realFetch
})

/** Runs the browser's two OAuth hops and returns the callback's response. */
async function githubSignIn(as: FakeGithubUser): Promise<Response> {
  githubUser = as
  const start = await auth.handler(
    new Request(`${ORIGIN}/api/auth/sign-in/social`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify({
        provider: "github",
        callbackURL: "/",
        errorCallbackURL: "/auth/sign-in",
      }),
    }),
  )
  expect(start.status).toBe(200)
  const { url } = (await start.json()) as { url: string }
  const state = new URL(url).searchParams.get("state") ?? ""
  const cookie = start.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ")

  return auth.handler(
    new Request(`${ORIGIN}/api/auth/callback/github?code=test-code&state=${state}`, {
      headers: { cookie },
    }),
  )
}

function locationOf(res: Response): URL {
  return new URL(res.headers.get("location") ?? "", ORIGIN)
}

describe("OAuth sign-in against the workspace gates", () => {
  afterEach(async () => {
    await truncateDomain()
  })

  test("the in-process harness has a GitHub provider to drive", () => {
    // If another suite imported env.ts first without these vars, the
    // provider is missing and every test below would pass for the wrong
    // reason (oauth_provider_not_found). Fail loudly instead.
    expect(Object.keys(auth.options.socialProviders ?? {})).toContain("github")
  })

  test("baseline: an ungated workspace signs a new GitHub user in", async () => {
    const res = await githubSignIn({ id: 101, email: "newbie@example.com" })
    expect(res.status).toBe(302)
    expect(locationOf(res).pathname).toBe("/")
    const [row] = await db.select().from(user).where(eq(user.email, "newbie@example.com"))
    expect(row).toBeDefined()
  })

  test("invite-only: an uninvited GitHub email lands on sign-in with not_invited", async () => {
    // The reported case: invited as alice@work.com, but GitHub's primary
    // email is personal — so the callback tries to create a brand-new user.
    await createUser("admin@work.com", "admin")
    await db.execute(sql`UPDATE app_settings SET signup_gated = true WHERE id = 1`)

    const res = await githubSignIn({ id: 102, email: "alice@personal.com" })
    expect(res.status).toBe(302)
    const location = locationOf(res)
    expect(location.pathname).toBe("/auth/sign-in")
    expect(location.searchParams.get("error")).toBe("not_invited")

    const [row] = await db.select().from(user).where(eq(user.email, "alice@personal.com"))
    expect(row).toBeUndefined()
  })

  test("domain allowlist: an off-list GitHub email lands on sign-in with domain_not_allowed", async () => {
    await db.execute(
      sql`UPDATE app_settings SET allowed_email_domains = ARRAY['work.com']::text[] WHERE id = 1`,
    )

    const res = await githubSignIn({ id: 103, email: "bob@personal.com" })
    expect(res.status).toBe(302)
    const location = locationOf(res)
    expect(location.pathname).toBe("/auth/sign-in")
    expect(location.searchParams.get("error")).toBe("domain_not_allowed")

    const [row] = await db.select().from(user).where(eq(user.email, "bob@personal.com"))
    expect(row).toBeUndefined()
  })
})
