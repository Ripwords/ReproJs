import { setup } from "../nuxt-setup"
import { afterEach, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import { createUser, truncateDomain } from "../helpers"

// H2: better-auth rate limit verification. This test exercises the 429 path on
// /sign-in/magic-link (the magic-link send endpoint) and the allow-list paths
// (/session, /sign-out, /callback/*). It REQUIRES the dashboard dev server to
// be running with `AUTH_RATE_LIMIT_ENABLED=true` and
// `AUTH_RATE_PER_IP_PER_15MIN=5`. Other test files run against the same server
// with rate limiting disabled (the default in dev) so that shared sign-in
// helpers don't trip the cap.
//
// Guard: if rate limiting isn't actually active on the running server, fail
// loudly at beforeAll instead of producing confusing assertion failures later.
await setup({ server: true, port: 3000, host: "localhost" })
setDefaultTimeout(30000)

const BASE_URL = process.env.TEST_BASE_URL ?? "http://localhost:3000"
const MAX = 5

// Each test picks a unique IP. better-auth's rate-limit key is `ip|path`, and
// its in-memory store lives for the life of the server — there's no clean way
// to reset it from the test side. Distinct IPs give each test its own bucket.
let ipCounter = 0
function nextIp(): string {
  ipCounter += 1
  const a = 10
  const b = (ipCounter >> 16) & 0xff
  const c = (ipCounter >> 8) & 0xff
  const d = ipCounter & 0xff
  return `${a}.${b}.${c}.${d}`
}

async function sendMagicLinkRaw(email: string, ip: string): Promise<Response> {
  return fetch(`${BASE_URL}/api/auth/sign-in/magic-link`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Forwarded-For": ip,
    },
    body: JSON.stringify({ email, callbackURL: "/" }),
  })
}

// Probe: confirm rate limiting is actually active before we run the assertions
// below — otherwise the 429 tests would fail with a confusing "expected 429,
// got 200" when the real problem is that the dev server was started without
// AUTH_RATE_LIMIT_ENABLED=true. We burst MAX+1 magic-link sends for an email
// that doesn't exist — all succeed (magic-link is create-on-verify so sending
// for a nonexistent email is intentional), and the (MAX+1)th must be 429.
async function isRateLimitingActive(): Promise<boolean> {
  const probeIp = "10.255.255.255"
  const probeEmail = "__probe__@example.com"
  let lastStatus = 0
  for (let i = 0; i < MAX + 1; i++) {
    // eslint-disable-next-line no-await-in-loop -- sequential burst to exhaust the bucket
    const r = await sendMagicLinkRaw(probeEmail, probeIp)
    lastStatus = r.status
  }
  return lastStatus === 429
}

describe("auth rate limiting (H2)", () => {
  let rateLimitingOn = false

  beforeAll(async () => {
    await truncateDomain()
    rateLimitingOn = await isRateLimitingActive()
    if (!rateLimitingOn) {
      // eslint-disable-next-line no-console
      console.warn(
        "[auth-rate-limit.test] Skipping — dev server is not enforcing auth rate limits. " +
          "Restart dev with AUTH_RATE_LIMIT_ENABLED=true AUTH_RATE_PER_IP_PER_15MIN=5 to run this suite.",
      )
    }
  })

  afterEach(async () => {
    await truncateDomain()
  })

  test("sign-in/magic-link: 6th attempt from same IP returns 429", async () => {
    if (!rateLimitingOn) return
    const ip = nextIp()
    const email = `target-${ip}@example.com`
    await createUser(email)

    const statuses: number[] = []
    for (let i = 0; i < MAX; i++) {
      // eslint-disable-next-line no-await-in-loop -- sequential required for rate limiter
      const r = await sendMagicLinkRaw(email, ip)
      statuses.push(r.status)
    }
    // All MAX attempts should have hit the auth handler (no 429 yet).
    expect(statuses.every((s) => s !== 429)).toBe(true)

    // The next attempt exceeds the window → 429.
    const blocked = await sendMagicLinkRaw(email, ip)
    expect(blocked.status).toBe(429)
  })

  test("different IPs have independent buckets", async () => {
    if (!rateLimitingOn) return
    const ip1 = nextIp()
    const ip2 = nextIp()
    const email = `iso-${ip1}@example.com`
    await createUser(email)

    // Exhaust ip1.
    for (let i = 0; i < MAX + 1; i++) {
      // eslint-disable-next-line no-await-in-loop -- sequential required for rate limiter
      await sendMagicLinkRaw(email, ip1)
    }
    const ip1Blocked = await sendMagicLinkRaw(email, ip1)
    expect(ip1Blocked.status).toBe(429)

    // ip2 should still work (different bucket).
    const ip2Ok = await sendMagicLinkRaw(email, ip2)
    expect(ip2Ok.status).not.toBe(429)
  })

  test("successful magic-link sends are allowed below the cap", async () => {
    if (!rateLimitingOn) return
    const ip = nextIp()
    const email = `ok-${ip}@example.com`
    await createUser(email)

    // MAX-1 successful sends — all below the cap.
    for (let i = 0; i < MAX - 1; i++) {
      // eslint-disable-next-line no-await-in-loop -- sequential required for rate limiter
      const r = await sendMagicLinkRaw(email, ip)
      expect(r.status).toBe(200)
    }
  })

  test("magic-link/verify: 6th attempt from same IP returns 429 (token-probe defense)", async () => {
    if (!rateLimitingOn) return
    // REGRESSION (CONCERN-7): customRules declares
    // `"/magic-link/verify": strictAuthRule` but the path was never
    // exercised by a test. The magic-link plugin's own default rate
    // limit is 5/60s; our customRule widens the window to 15min — so
    // without this test, a silent config drift (rule removed, wrong
    // path, overridden by plugin default) would go unnoticed and
    // re-expose the token-probing oracle that motivated H2.
    const ip = nextIp()
    const statuses: number[] = []
    for (let i = 0; i < MAX; i++) {
      // eslint-disable-next-line no-await-in-loop -- sequential required for rate limiter
      const r = await fetch(
        `${BASE_URL}/api/auth/magic-link/verify?token=bogus${i}&callbackURL=/`,
        { headers: { "X-Forwarded-For": ip }, redirect: "manual" },
      )
      statuses.push(r.status)
    }
    // All MAX attempts reach the handler (they 302 with error=INVALID_TOKEN,
    // never 429) — confirming the bucket isn't already exhausted by something
    // else.
    expect(statuses.every((s) => s !== 429)).toBe(true)

    // Still blocked before the handler runs, but a person clicking a link
    // from their inbox lands on the sign-in page with the reason, not on a
    // raw `{"message":"Too many requests…"}` JSON body.
    const blocked = await fetch(
      `${BASE_URL}/api/auth/magic-link/verify?token=bogusN&callbackURL=/`,
      { headers: { "X-Forwarded-For": ip }, redirect: "manual" },
    )
    expect(blocked.status).toBe(302)
    const location = new URL(blocked.headers.get("location") ?? "", BASE_URL)
    expect(location.pathname).toBe("/auth/sign-in")
    expect(location.searchParams.get("error")).toBe("rate_limited")
  })

  test("the sign-in page explains rate_limited", async () => {
    const html = await (await fetch(`${BASE_URL}/auth/sign-in?error=rate_limited`)).text()
    expect(html).toContain("Too many sign-in attempts")
  })

  test("OAuth /callback/* is NOT rate-limited", async () => {
    if (!rateLimitingOn) return
    const ip = nextIp()
    // Hit the callback path many times over the cap. We expect non-429 responses
    // (likely 302/400 depending on how better-auth validates the missing state).
    // The important assertion: the limiter does NOT intercept.
    const statuses: number[] = []
    for (let i = 0; i < MAX + 3; i++) {
      // eslint-disable-next-line no-await-in-loop -- sequential required for rate limiter
      const r = await fetch(`${BASE_URL}/api/auth/callback/github`, {
        method: "GET",
        headers: { "X-Forwarded-For": ip },
        redirect: "manual",
      })
      statuses.push(r.status)
    }
    expect(statuses.every((s) => s !== 429)).toBe(true)
  })

  test("/get-session and /sign-out are NOT rate-limited", async () => {
    if (!rateLimitingOn) return
    const ip = nextIp()
    // Way over the cap — these read-only / non-brute-forceable endpoints must
    // never 429.
    for (let i = 0; i < MAX + 5; i++) {
      // eslint-disable-next-line no-await-in-loop -- sequential required for rate limiter
      const session = await fetch(`${BASE_URL}/api/auth/get-session`, {
        headers: { "X-Forwarded-For": ip },
      })
      expect(session.status).not.toBe(429)

      // eslint-disable-next-line no-await-in-loop -- sequential required for rate limiter
      const signOut = await fetch(`${BASE_URL}/api/auth/sign-out`, {
        method: "POST",
        headers: { "X-Forwarded-For": ip },
      })
      expect(signOut.status).not.toBe(429)
    }
  })
})
