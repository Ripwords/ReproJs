import { describe, expect, setDefaultTimeout, test } from "bun:test"

setDefaultTimeout(30000)

const BASE_URL = process.env.TEST_BASE_URL ?? "http://localhost:3000"

/**
 * Regression cover for the two ways a failed sign-in used to dead-end.
 *
 * better-auth's magic-link verify redirects failures to `errorCallbackURL`,
 * defaulting to `callbackURL` — the post-login destination. That meant:
 *
 *   1. The failure landed on a page the (still signed-out) user can't see,
 *      the global auth guard bounced them to /auth/sign-in, and the
 *      `?error=` code was folded into `next` where nothing reads it. The
 *      login form reappeared with no explanation.
 *   2. When the destination was a POST-only API route, the browser got a
 *      bare "405 Method not allowed" — the reported
 *      `/api/intake/reports?error=ATTEMPTS_EXCEEDED`.
 */
describe("auth error redirects", () => {
  test("a signed-out page hit with ?error= forwards the code to the sign-in page", async () => {
    const res = await fetch(`${BASE_URL}/?error=ATTEMPTS_EXCEEDED`, { redirect: "manual" })
    expect([302, 303]).toContain(res.status)

    const location = new URL(res.headers.get("location") ?? "", BASE_URL)
    expect(location.pathname).toBe("/auth/sign-in")
    // The code must arrive as a first-class query param the page reads —
    // not buried inside `next`, which is what used to happen.
    expect(location.searchParams.get("error")).toBe("ATTEMPTS_EXCEEDED")
  })

  test("the post-sign-in destination no longer carries the stale error code", async () => {
    const res = await fetch(`${BASE_URL}/projects?error=EXPIRED_TOKEN`, { redirect: "manual" })
    expect([302, 303]).toContain(res.status)

    const location = new URL(res.headers.get("location") ?? "", BASE_URL)
    const next = location.searchParams.get("next") ?? ""
    expect(next).toContain("/projects")
    expect(next).not.toContain("error")
  })

  test("a next pointing at a POST-only API route is dropped, not honoured", async () => {
    const res = await fetch(`${BASE_URL}/api/intake/reports`, { redirect: "manual" })
    // The endpoint itself stays POST-only, and now says so per RFC 9110.
    expect(res.status).toBe(405)
    expect(res.headers.get("allow")).toBe("POST, OPTIONS")
  })

  test("the sign-in page explains every magic-link failure code", async () => {
    // Each code better-auth's magic-link verify can redirect with must
    // produce real copy — never a blank page, which was the whole bug.
    for (const code of ["INVALID_TOKEN", "EXPIRED_TOKEN", "ATTEMPTS_EXCEEDED"]) {
      const res = await fetch(`${BASE_URL}/auth/sign-in?error=${code}`)
      expect(res.status).toBe(200)
      const html = await res.text()
      expect(html).toContain("sign-in link")
    }
  })

  test("the workspace gate codes still render their own copy", async () => {
    // Regression guard: these two used to live in a local map inside
    // sign-in.vue that was replaced wholesale by AUTH_ERROR_MESSAGES.
    const domain = await (await fetch(`${BASE_URL}/auth/sign-in?error=domain_not_allowed`)).text()
    expect(domain).toContain("domain")
    const invited = await (await fetch(`${BASE_URL}/auth/sign-in?error=not_invited`)).text()
    expect(invited).toContain("invite-only")
  })

  test("a legitimate destination survives the guard with its own query intact", async () => {
    // `next` is re-encoded on the way out, so the sign-in page must be able
    // to decode it back to exactly what the user asked for — otherwise the
    // error-stripping rewrite would quietly corrupt post-login redirects.
    const res = await fetch(`${BASE_URL}/projects/abc?status=open&tag=ui`, { redirect: "manual" })
    expect([302, 303]).toContain(res.status)

    const location = new URL(res.headers.get("location") ?? "", BASE_URL)
    expect(location.searchParams.get("next")).toBe("/projects/abc?status=open&tag=ui")
  })

  test("an unrecognised error code still surfaces rather than rendering silence", async () => {
    const res = await fetch(`${BASE_URL}/auth/sign-in?error=some_future_code`)
    expect(res.status).toBe(200)
    expect(await res.text()).toContain("some_future_code")
  })
})
