import { describe, expect, test } from "bun:test"
import {
  authErrorMessage,
  pinMagicLinkRedirects,
  safeNextPath,
  SIGN_IN_PATH,
} from "../../shared/auth-redirect"

describe("safeNextPath", () => {
  test("passes through an ordinary app path with query + hash", () => {
    expect(safeNextPath("/projects/abc/reports?status=open#top")).toBe(
      "/projects/abc/reports?status=open#top",
    )
  })

  test("falls back when next is missing or not a string", () => {
    expect(safeNextPath(undefined)).toBe("/")
    expect(safeNextPath(null)).toBe("/")
    expect(safeNextPath("")).toBe("/")
    expect(safeNextPath(["/a", "/b"])).toBe("/")
  })

  test("THE 405 BUG: a POST-only intake route is never a redirect target", () => {
    // better-auth reuses callbackURL as the error redirect when no
    // errorCallbackURL is given, so this value turned an already-used magic
    // link into `/api/intake/reports?error=ATTEMPTS_EXCEEDED` → raw 405.
    expect(safeNextPath("/api/intake/reports")).toBe("/")
    expect(safeNextPath("/api/intake/media")).toBe("/")
    expect(safeNextPath("/api/auth/get-session")).toBe("/")
    expect(safeNextPath("/api/projects/1?x=1")).toBe("/")
  })

  test("keeps the one API route GitHub bounces the browser into", () => {
    expect(
      safeNextPath(
        "/api/integrations/github/install-callback?installation_id=9&setup_action=install",
      ),
    ).toBe("/api/integrations/github/install-callback?installation_id=9&setup_action=install")
  })

  test("rejects off-origin destinations", () => {
    expect(safeNextPath("https://evil.example/steal")).toBe("/")
    expect(safeNextPath("//evil.example/steal")).toBe("/")
    expect(safeNextPath("/\\evil.example/steal")).toBe("/")
    expect(safeNextPath("javascript:alert(1)")).toBe("/")
    expect(safeNextPath("http://evil.example")).toBe("/")
  })

  test("refuses to bounce back to the sign-in page (redirect loop)", () => {
    expect(safeNextPath(SIGN_IN_PATH)).toBe("/")
    expect(safeNextPath(`${SIGN_IN_PATH}?next=%2F`)).toBe("/")
  })

  test("honours an explicit fallback", () => {
    expect(safeNextPath("/api/intake/reports", "/settings")).toBe("/settings")
  })

  test("does not treat a path merely starting with /api as an API route", () => {
    expect(safeNextPath("/apiary")).toBe("/apiary")
  })
})

describe("authErrorMessage", () => {
  test("returns null when there is no error code", () => {
    expect(authErrorMessage(undefined)).toBeNull()
    expect(authErrorMessage(null)).toBeNull()
    expect(authErrorMessage("")).toBeNull()
    expect(authErrorMessage(["a"])).toBeNull()
  })

  test("explains every magic-link failure better-auth can redirect with", () => {
    // Source of truth: better-auth/dist/plugins/magic-link — redirectWithError.
    for (const code of [
      "INVALID_TOKEN",
      "EXPIRED_TOKEN",
      "ATTEMPTS_EXCEEDED",
      "failed_to_create_user",
      "failed_to_create_session",
      "new_user_signup_disabled",
    ]) {
      const message = authErrorMessage(code)
      expect(message).toBeTruthy()
      // A code leaking into the copy means we fell through to the generic
      // branch instead of writing real copy for it.
      expect(message).not.toContain(code)
    }
  })

  test("keeps explaining the workspace gates", () => {
    expect(authErrorMessage("domain_not_allowed")).toContain("domain")
    expect(authErrorMessage("not_invited")).toContain("invite")
  })

  test("surfaces an unknown code verbatim instead of staying silent", () => {
    expect(authErrorMessage("some_new_better_auth_code")).toBe(
      "Sign-in was rejected (some_new_better_auth_code).",
    )
  })

  test("explains the OAuth callback codes better-auth actually emits", () => {
    // Source of truth: better-auth/dist/api/routes/callback.mjs — every
    // redirectOnError() call site, which lands on the errorCallbackURL we pin.
    for (const code of [
      "no_code",
      "oauth_provider_not_found",
      "invalid_code",
      "unable_to_get_user_info",
      "no_callback_url",
      "unable_to_link_account",
      "account_already_linked_to_different_user",
      "email_not_found",
      "email_doesn't_match",
    ]) {
      const message = authErrorMessage(code)
      expect(message).toBeTruthy()
      expect(message).not.toContain(code)
    }
  })

  test("does not echo a code that isn't shaped like a code", () => {
    // The sign-in page renders this string, so `?error=` is attacker-supplied
    // text reflected onto the login screen. Vue escapes it (no XSS), but a
    // crafted link could still put a sentence of the attacker's choosing next
    // to the password-less login form — "call this number to restore access".
    // Only echo values that look like a real better-auth code; anything else
    // falls back to the generic copy the page used before.
    for (const hostile of [
      "Your account was locked. Call +1-555-0100 to restore access",
      "<script>alert(1)</script>",
      "a".repeat(65),
      "code with spaces",
      "http://evil.example",
    ]) {
      expect(authErrorMessage(hostile)).toBe("Sign-in was rejected.")
    }
  })

  test("still echoes the real code shapes better-auth emits", () => {
    // Guards the clamp against being drawn too tight: every code in the map
    // plus the shapes better-auth builds at runtime must survive it.
    expect(authErrorMessage("issuer_mismatch")).toBe("Sign-in was rejected (issuer_mismatch).")
    expect(authErrorMessage("EMAIL_NOT_VERIFIED")).toBe(
      "Sign-in was rejected (EMAIL_NOT_VERIFIED).",
    )
    // The one real code with a character the clamp rejects — which is why it
    // has real copy in the map rather than relying on the echo fallback.
    expect(authErrorMessage("email_doesn't_match")).not.toContain("rejected")
    expect(authErrorMessage("a".repeat(64))).toContain("Sign-in was rejected (")
  })
})

describe("pinMagicLinkRedirects", () => {
  test("always pins errorCallbackURL to the sign-in page", () => {
    // Without this, better-auth defaults errorCallbackURL to callbackURL and
    // an expired/used link lands on a page the signed-out user can't see.
    expect(pinMagicLinkRedirects({ email: "a@b.com", callbackURL: "/projects" })).toEqual({
      email: "a@b.com",
      callbackURL: "/projects",
      errorCallbackURL: SIGN_IN_PATH,
    })
  })

  test("overrides an errorCallbackURL the client tried to choose", () => {
    const pinned = pinMagicLinkRedirects({
      email: "a@b.com",
      callbackURL: "/api/intake/reports",
      errorCallbackURL: "/api/intake/reports",
    })
    expect(pinned.errorCallbackURL).toBe(SIGN_IN_PATH)
    expect(pinned.callbackURL).toBe("/")
  })

  test("fills in a default callbackURL when the client omits one", () => {
    expect(pinMagicLinkRedirects({ email: "a@b.com" }).callbackURL).toBe("/")
  })

  test("leaves the rest of the body untouched", () => {
    const pinned = pinMagicLinkRedirects({ email: "a@b.com", name: "Ada", extra: 1 })
    expect(pinned.email).toBe("a@b.com")
    expect(pinned.name).toBe("Ada")
    expect(pinned.extra).toBe(1)
  })
})
