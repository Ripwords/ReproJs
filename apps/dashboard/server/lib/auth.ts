import { count, eq, sql } from "drizzle-orm"
import { betterAuth, type GenericEndpointContext } from "better-auth"
import { APIError, createAuthMiddleware } from "better-auth/api"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { magicLink } from "better-auth/plugins/magic-link"
import { jwt } from "better-auth/plugins/jwt"
import { oauthProvider } from "@better-auth/oauth-provider"
import { db } from "../db"
import {
  magicLinkLandingUrl,
  pinMagicLinkRedirects,
  SIGN_IN_PATH,
} from "../../shared/auth-redirect"
import { appSettings, session, user } from "../db/schema"
import { isEmailDomainOnAllowlist } from "./email-domain"
import { env, getAuthRateLimitEnabled } from "./env"
import { renderTemplate } from "./render-template"
import { sendMail } from "./email"

// H2: auth endpoint rate limiting. Sign-in and magic-link verify are the
// credential-guessing / token-probing oracles — without a cap an attacker
// brute-forces at database speed. 5 attempts per 15 minutes per IP is the
// industry-standard login cap (permissive enough for humans retrying a typo).
//
// Deliberately NOT rate-limited:
//   - /session (read-only, not brute-forceable)
//   - /sign-out (not brute-forceable)
//   - /callback/* (OAuth provider callbacks — capping breaks real login flows)
const AUTH_RATE_WINDOW_SEC = 15 * 60
// Enable in production by default (matches better-auth's own default).
// `AUTH_RATE_LIMIT_ENABLED=true` force-enables in dev/test so the dedicated
// test suite (and local smoke tests) can exercise the 429 path.
// `AUTH_RATE_LIMIT_ENABLED=false` disables even in production (escape hatch).

const strictAuthRule = { window: AUTH_RATE_WINDOW_SEC, max: env.AUTH_RATE_PER_IP_PER_15MIN }

/**
 * Load the singleton `app_settings` row, or throw if it's missing. The
 * seed plugin at server/plugins/00.seed-settings.ts guarantees this row
 * exists at startup; if an operational mishap (manual DELETE, failed
 * migration, corrupt restore) has wiped it, we MUST fail auth closed
 * rather than silently bypass the signup gate and the domain allowlist.
 */
async function loadAppSettings() {
  const [settings] = await db.select().from(appSettings).limit(1)
  if (!settings) {
    throw new APIError("INTERNAL_SERVER_ERROR", {
      message:
        "app_settings row is missing — refusing to auth without gate state. " +
        "Restart the server so 00.seed-settings.ts re-seeds, or INSERT the row manually.",
    })
  }
  return settings
}

/**
 * Returns true iff the email's domain is on the workspace allowlist, or
 * the allowlist is empty (no restriction configured). Throws via
 * loadAppSettings when app_settings is missing — caller sees this as a
 * 500, which is the desired fail-closed behavior.
 */
async function isEmailDomainAllowed(email: string): Promise<boolean> {
  const settings = await loadAppSettings()
  return isEmailDomainOnAllowlist(email, settings.allowedEmailDomains)
}

/**
 * Revoke the session better-auth just planted for `userId`. Used when an
 * existing user is refused at sign-in (account disabled, or a domain that is
 * no longer on the allowlist): the user already has their row + memberships
 * + OAuth linkage, and we must NOT cascade-delete those assets just because
 * policy changed. Dropping the session row
 * invalidates the cookie that `setSessionCookie` already sent.
 */
async function revokeJustCreatedSession(userId: string): Promise<void> {
  await db.delete(session).where(eq(session.userId, userId))
}

/**
 * Flip `status=invited` → `active` on first successful sign-in.
 *
 * Pre-invited rows are inserted by `POST /api/users` with status=`invited`;
 * better-auth's `findUserByEmail` resolves them before calling createUser,
 * so they never trip the signup-gate in `create.before`. This hook just
 * promotes them to `active` once they actually sign in.
 */
async function promoteInvitedToActive(userId: string): Promise<void> {
  const [existing] = await db.select().from(user).where(eq(user.id, userId))
  if (!existing || existing.status !== "invited") return
  await db.update(user).set({ status: "active" }).where(eq(user.id, userId))
}

/**
 * First-user bootstrap: if this brand-new user is the only row in the
 * table, promote them to `admin` so a fresh self-host install hands
 * ownership to the first person who signs in.
 *
 * Called from `databaseHooks.user.create.after` — which fires only on a
 * legitimate brand-new INSERT — so we have an unambiguous signal that
 * this is a new user, not a returning or invited one. Wrapped in a
 * Postgres advisory lock so two concurrent first-user sign-ups can't
 * both see `totalUsers === 1` and both claim admin.
 */
async function bootstrapFirstUserAsAdmin(userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    // hashtext() + advisory xact lock auto-releases on commit/rollback.
    // Key is a constant string unique to this promotion.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('auth.first_admin'))`)
    const [countRow] = await tx.select({ c: count() }).from(user)
    const totalUsers = countRow?.c ?? 0
    if (totalUsers !== 1) return
    await tx.update(user).set({ role: "admin" }).where(eq(user.id, userId))
  })
}

/**
 * Refuse a brand-new user row so the browser ends up on
 * `/auth/sign-in?error=<code>` whichever sign-in path created it.
 *
 * The two paths handle a throw from `create.before` differently:
 *
 *  - Magic-link verify lets an APIError propagate, and better-auth passes a
 *    redirect (`APIError("FOUND")`) straight through as a 302 — so we
 *    redirect to the sign-in page ourselves.
 *  - The OAuth callback wraps user creation in handleOAuthUserInfo
 *    (oauth2/link-account), which catches any APIError and returns
 *    `{ error: e.message }`; the callback then redirects to the client's
 *    `errorCallbackURL` with `?error=<message>`. A redirect's message is
 *    empty, so `if (result.error)` was falsy and the callback crashed with a
 *    bare 500 destructuring `result.data` (null). Throwing an APIError whose
 *    message IS the code lets better-auth do the redirect — the sign-in page
 *    passes `/auth/sign-in` as errorCallbackURL.
 *
 * Without an endpoint ctx (programmatic auth.api.createUser) the plain
 * APIError is the clearest refusal.
 */
function rejectSignup(
  ctx: GenericEndpointContext | null,
  code: "domain_not_allowed" | "not_invited",
): never {
  if (!ctx || ctx.path.startsWith("/callback/")) {
    throw new APIError("FORBIDDEN", { message: code })
  }
  throw ctx.redirect(signInErrorURL(ctx.context.baseURL, code))
}

function signInErrorURL(baseURL: string, code: string): string {
  const url = new URL(SIGN_IN_PATH, baseURL)
  url.searchParams.set("error", code)
  return url.toString()
}

export const auth = betterAuth({
  baseURL: env.BETTER_AUTH_URL,
  // BETTER_AUTH_URL's origin is always trusted; these are the extras.
  trustedOrigins: env.BETTER_AUTH_TRUSTED_ORIGINS,
  secret: env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, { provider: "pg" }),
  rateLimit: {
    enabled: getAuthRateLimitEnabled(),
    // In-process memory store. Fine for single-process self-host (our default
    // deployment target). Multi-worker setups should flip to `database` or wire
    // `customStorage` into the same Postgres bucket table the intake uses.
    storage: "memory",
    customRules: {
      // Strict caps on all sign-in + verify paths. `/sign-in/*` covers the
      // magic-link send endpoint (`/sign-in/magic-link`). `/magic-link/verify`
      // is the token-probing oracle — even with 32-char crypto-random tokens
      // the cap bounds an exfiltrated-DB scenario.
      "/sign-in/*": strictAuthRule,
      "/magic-link/verify": strictAuthRule,
      // Explicitly opt OUT of rate limiting for these — `false` bypasses the
      // limiter entirely (see better-auth/api/rate-limiter resolveRateLimitConfig).
      "/get-session": false,
      "/sign-out": false,
      "/callback/*": false,
    },
  },
  socialProviders: {
    ...(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET
      ? {
          github: {
            clientId: env.GITHUB_CLIENT_ID,
            clientSecret: env.GITHUB_CLIENT_SECRET,
          },
        }
      : {}),
    ...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? {
          google: {
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET,
          },
        }
      : {}),
  },
  plugins: [
    magicLink({
      // Tokens expire after 5 minutes by default; tight window is the point.
      //
      // allowedAttempts is better-auth's default (1), spelled out because its
      // failure mode is easy to misread: the verify endpoint increments the
      // counter on EVERY GET of the verify URL — including the successful
      // one — so the link is strictly single-use. Mail gateways that
      // prefetch links (Outlook Safe Links, Proofpoint, most AV scanners)
      // would spend it before the human clicks, so the email never contains
      // the verify URL: it links to a landing page whose button sends the
      // verify request (see magicLinkLandingUrl).
      allowedAttempts: 1,
      sendMagicLink: async ({ email, url }) => {
        const html = await renderTemplate("magic-link", { url: magicLinkLandingUrl(url) })
        await sendMail({
          to: email,
          subject: "Your sign-in link",
          html,
        })
      },
    }),
    ...(env.MCP_ENABLED
      ? [
          jwt(),
          oauthProvider({
            // Must be the real sign-in route. "/sign-in" does not exist —
            // the global auth guard bounces it to "/auth/sign-in?next=…",
            // and the nested unencoded query drops the OAuth/PKCE params
            // (state, code_challenge, signed exp/sig), breaking the flow.
            loginPage: "/auth/sign-in",
            consentPage: "/oauth/consent",
            allowDynamicClientRegistration: true,
            allowUnauthenticatedClientRegistration: true,
            scopes: ["mcp:full"] as const,
            // scopeExpirations controls access token lifetime per scope.
            // refreshTokenExpiresIn (global) handles the 30-day refresh window.
            accessTokenExpiresIn: env.MCP_ACCESS_TOKEN_TTL_SECONDS,
            refreshTokenExpiresIn: 60 * 60 * 24 * 30,
            validAudiences: [`${env.BETTER_AUTH_URL}/api/mcp`],
          }),
        ]
      : []),
  ],
  user: {
    additionalFields: {
      role: { type: "string", defaultValue: "member", input: false },
      status: { type: "string", defaultValue: "active", input: false },
    },
  },
  databaseHooks: {
    user: {
      create: {
        // Signup gate. Fires ONLY when a brand-new user row is about to be
        // inserted — which means neither an existing account nor a pre-seeded
        // `invited` row matched the email (better-auth resolves those via
        // findUserByEmail before ever calling create). See rejectSignup for
        // how each sign-in path turns the refusal into
        // /auth/sign-in?error=<code>.
        before: async (newUser, ctx) => {
          // Domain allowlist: a new sign-up from an off-allowlist domain
          // is rejected at insert time so no orphan user row is ever
          // created. Existing users whose domain is now off-list are
          // handled in the after-hook (see revokeJustCreatedSession).
          const emailLower = newUser.email.toLowerCase()
          if (!(await isEmailDomainAllowed(emailLower))) {
            rejectSignup(ctx, "domain_not_allowed")
          }

          // Signup gate. loadAppSettings throws if the settings row is
          // missing (fail-closed); if present but signup_gated=false,
          // let the create proceed.
          const settings = await loadAppSettings()
          if (!settings.signupGated) return { data: newUser }
          rejectSignup(ctx, "not_invited")
        },
        // First-user bootstrap lives here (not in the auth after-hook) so
        // we have an unambiguous "brand-new row just inserted" signal
        // instead of timestamp heuristics. See bootstrapFirstUserAsAdmin.
        after: async (newUser) => {
          await bootstrapFirstUserAsAdmin(newUser.id)
        },
      },
    },
  },
  hooks: {
    // Pin the two redirect targets baked into every magic link at mint time.
    //
    // better-auth falls back to `callbackURL` for its FAILURE redirects when
    // no `errorCallbackURL` is supplied, so whatever the client passed as the
    // post-login destination also becomes where INVALID_TOKEN /
    // EXPIRED_TOKEN / ATTEMPTS_EXCEEDED land. That produced two live bugs:
    // an error landing on a signed-out page bounced through the auth guard
    // and lost its `?error=` (silent return to the login form), and a
    // `?next=/api/intake/reports` sign-in sent the failure to a POST-only
    // route, rendering a bare "405 Method not allowed".
    //
    // The sign-in page sets both values correctly now; this hook makes it
    // unconditional, so a cached client bundle or a hand-rolled POST to
    // /sign-in/magic-link can't reintroduce either failure.
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== "/sign-in/magic-link") return
      const body = (ctx.body ?? {}) as Record<string, unknown>
      return { context: { body: pinMagicLinkRedirects(body) } }
    }),
    after: createAuthMiddleware(async (ctx) => {
      // SEC1: guard OAuth callbacks AND magic-link verification against the
      // same workspace gates. The user's email isn't known until after the
      // provider callback / token verify completes, so this check must live
      // in the `after` hook (before-hook body has no user yet).
      //
      // `ctx.context.newSession` is populated by `setSessionCookie` on both
      // code paths (see better-auth cookies/index.mjs setSessionCookie →
      // setNewSession). Reading from newSession — rather than
      // ctx.context.returned — is required for the magic-link verify redirect
      // path, where `returned` is an APIError(FOUND) instead of a user object.
      const isCallback = ctx.path.startsWith("/callback/")
      const isMagicLinkVerify = ctx.path === "/magic-link/verify"
      if (!isCallback && !isMagicLinkVerify) return

      const newSession = ctx.context.newSession
      const newUser = newSession?.user
      if (!newUser?.id || !newUser.email) return

      // A disabled user can still complete a magic link or an OAuth round
      // trip; better-auth knows nothing about our `status` column. Drop the
      // session it just planted and say why, rather than let them land on a
      // dashboard where every request answers 403.
      const [row] = await db
        .select({ status: user.status })
        .from(user)
        .where(eq(user.id, newUser.id))
      if (row?.status === "disabled") {
        await revokeJustCreatedSession(newUser.id)
        throw ctx.redirect(signInErrorURL(ctx.context.baseURL, "account_disabled"))
      }

      // Post-hoc domain allowlist tightening: an existing user whose
      // row was provisioned when their domain was allowed but no longer
      // qualifies. Revoke the session better-auth just planted (do NOT
      // delete the user — that was the bug that prompted BLOCKER-1) and
      // redirect them to the sign-in page with an error. Their data
      // (memberships, OAuth linkages, ticket assignments) stays intact
      // so a later allowlist relaxation lets them back in cleanly.
      if (!(await isEmailDomainAllowed(newUser.email))) {
        await revokeJustCreatedSession(newUser.id)
        const errorUrl = new URL(
          "/auth/sign-in?error=domain_not_allowed",
          ctx.context.baseURL,
        ).toString()
        throw ctx.redirect(errorUrl)
      }
      await promoteInvitedToActive(newUser.id)
    }),
  },
})

export type Auth = typeof auth
