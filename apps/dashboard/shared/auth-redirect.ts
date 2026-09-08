/**
 * Where a sign-in flow may legally drop the browser, and how we phrase the
 * failures better-auth hands back.
 *
 * Lives in `shared/` because both halves of the flow need it: the Vue sign-in
 * page builds the `callbackURL` it passes to better-auth, and the
 * `hooks.before` in `server/lib/auth.ts` re-validates that value so a stale
 * client bundle (or a hand-rolled POST to /sign-in/magic-link) can't mint a
 * link that redirects somewhere the browser can't render.
 */

export const SIGN_IN_PATH = "/auth/sign-in"
export const DEFAULT_POST_SIGN_IN_PATH = "/"

/**
 * `/api/*` handlers answer with JSON, a redirect, or a bare status line —
 * never a page. Landing a browser on one is a dead end, and on the POST-only
 * intake routes it renders a raw `405 Method not allowed` with no way back.
 *
 * That is the bug this guard exists for: better-auth's magic-link verify
 * reuses `callbackURL` as the *error* redirect target when no
 * `errorCallbackURL` is supplied, so a sign-in started from
 * `/auth/sign-in?next=/api/intake/reports` turned an already-used link into
 * `…/api/intake/reports?error=ATTEMPTS_EXCEEDED` → 405.
 *
 * One API route is deliberately browser-navigable — GitHub bounces the
 * browser into it after an App install, and `install-callback.get.ts` puts
 * its own path into `?next=` on the signed-out path — so it stays legal.
 */
const BROWSER_NAVIGABLE_API_PATHS = new Set(["/api/integrations/github/install-callback"])

// Any absolute base works; we only ever read back the path half. Using a
// non-routable host makes "did this resolve off-origin?" a cheap identity
// check instead of a substring hunt.
const RESOLUTION_BASE = "https://repro.invalid"

/**
 * Normalise a `?next=` value into a path this app can actually render.
 *
 * Returns `fallback` for anything that isn't a same-origin page path:
 * absolute URLs, protocol-relative `//evil.com`, backslash variants some
 * browsers fold into `//`, non-navigable `/api/*` routes, and the sign-in
 * page itself (which would loop).
 */
export function safeNextPath(next: unknown, fallback: string = DEFAULT_POST_SIGN_IN_PATH): string {
  if (typeof next !== "string" || next.length === 0) return fallback
  // Must be site-relative. `//evil.com` and `/\evil.com` are rejected up
  // front rather than relied on the origin check below, so the intent is
  // legible even if the WHATWG normalisation rules change under us.
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback

  let parsed: URL
  try {
    parsed = new URL(next, RESOLUTION_BASE)
  } catch {
    return fallback
  }
  if (parsed.origin !== RESOLUTION_BASE) return fallback

  const { pathname } = parsed
  if (pathname.startsWith("/api/") && !BROWSER_NAVIGABLE_API_PATHS.has(pathname)) return fallback
  if (pathname === SIGN_IN_PATH) return fallback

  return `${pathname}${parsed.search}${parsed.hash}`
}

/**
 * Error codes that can reach the sign-in page as `?error=<code>`.
 *
 *  - snake_case lowercase — our own workspace gates in `server/lib/auth.ts`
 *    and better-auth's OAuth callback (`api/routes/callback`).
 *  - SCREAMING_CASE — better-auth's magic-link verify
 *    (`plugins/magic-link`): INVALID_TOKEN, EXPIRED_TOKEN, ATTEMPTS_EXCEEDED,
 *    failed_to_create_user, failed_to_create_session,
 *    new_user_signup_disabled.
 *
 * ATTEMPTS_EXCEEDED is the common one in the wild: the plugin defaults to
 * `allowedAttempts: 1` and bumps the counter on *every* GET of the verify
 * URL, so a mail gateway that prefetches links (Outlook Safe Links,
 * Proofpoint, antivirus scanners) burns the single attempt before the human
 * clicks.
 */
export const AUTH_ERROR_MESSAGES: Record<string, string> = {
  // Workspace gates — server/lib/auth.ts
  domain_not_allowed: "Your email domain isn't allowed on this workspace.",
  not_invited: "Sign-up is invite-only. Ask an admin to invite you first.",

  // better-auth magic-link verify
  INVALID_TOKEN: "That sign-in link is no longer valid. Request a fresh one below.",
  EXPIRED_TOKEN:
    "That sign-in link expired — links are only good for 5 minutes. Request a fresh one below.",
  ATTEMPTS_EXCEEDED:
    "That sign-in link has already been used. Some email providers open links automatically, so this can happen on the first click — request a fresh one below.",
  failed_to_create_user:
    "We couldn't create your account. Ask a workspace admin to check the server logs.",
  failed_to_create_session: "We couldn't start your session. Try signing in again.",
  new_user_signup_disabled:
    "Sign-up is disabled on this workspace. Ask an admin to invite you first.",

  // better-auth OAuth callback
  state_mismatch: "The sign-in didn't finish safely and was cancelled. Start again below.",
  please_restart_the_process:
    "The sign-in didn't finish safely and was cancelled. Start again below.",
  invalid_callback_request:
    "The provider sent back a response we couldn't read. Start again below.",
  no_code: "The provider didn't return an authorization code. Start again below.",
  invalid_code: "The provider's authorization code was rejected. Start again below.",
  oauth_provider_not_found: "That sign-in provider isn't configured on this workspace.",
  unable_to_get_user_info: "We couldn't read your profile from the provider. Start again below.",
  email_not_found:
    "The provider didn't share an email address, so we can't match you to an account.",
  account_not_linked:
    "An account already exists with that email. Sign in the way you did the first time, then link this provider from Settings.",
  unable_to_link_account: "We couldn't link that provider to your account.",
  account_already_linked_to_different_user:
    "That provider account is already linked to a different user on this workspace.",
  "email_doesn't_match": "The provider's email doesn't match the account you're linking it to.",
  no_callback_url: "The sign-in didn't carry a destination. Start again below.",
  unable_to_create_user:
    "We couldn't create your account. Ask a workspace admin to check the server logs.",
  unable_to_create_session: "We couldn't start your session. Try signing in again.",
  signup_disabled: "Sign-up is disabled on this workspace. Ask an admin to invite you first.",
  internal_server_error: "The server hit an error finishing your sign-in. Try again in a moment.",
}

/**
 * The shape every code above shares, and every code better-auth builds at
 * runtime (`result.error.split(" ").join("_")` in api/routes/callback.mjs).
 *
 * `?error=` is attacker-influenced: anyone can hand a victim a link to
 * `/auth/sign-in?error=<anything>`. The sign-in page renders that text, and
 * while Vue escapes it (so this is not XSS), an unclamped echo would let a
 * crafted link print an attacker's sentence next to the real login form —
 * "your account is locked, call this number". Codes get echoed; prose does
 * not.
 */
const ERROR_CODE_RE = /^[\w.-]{1,64}$/

/**
 * Human-readable copy for a `?error=` code, or `null` when there is no error.
 *
 * Unknown codes still produce a message — an unexplained bounce back to the
 * login screen is the failure mode this whole change is about, so an
 * unrecognised code is surfaced verbatim rather than swallowed. Anything that
 * isn't shaped like a code falls back to the generic copy.
 */
export function authErrorMessage(code: unknown): string | null {
  if (typeof code !== "string" || code.length === 0) return null
  const known = AUTH_ERROR_MESSAGES[code]
  if (known) return known
  return ERROR_CODE_RE.test(code) ? `Sign-in was rejected (${code}).` : "Sign-in was rejected."
}

/**
 * The redirect targets every minted magic link must carry, whatever the
 * client asked for.
 *
 * `callbackURL` is narrowed to a renderable page path, and `errorCallbackURL`
 * is pinned to the sign-in page so better-auth's verify failures can never
 * fall back to `callbackURL` (its default) and strand the user on a page that
 * either swallows the reason or, for a POST-only API route, answers 405.
 *
 * Lives here rather than inline in the auth hook so the policy is unit
 * testable without booting `server/lib/auth.ts` and its database imports.
 */
export function pinMagicLinkRedirects<T extends Record<string, unknown>>(
  body: T,
): T & { callbackURL: string; errorCallbackURL: string } {
  return {
    ...body,
    callbackURL: safeNextPath(body.callbackURL),
    errorCallbackURL: SIGN_IN_PATH,
  }
}
