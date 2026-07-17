import { randomBytes } from "node:crypto"
import { desc, eq, sql } from "drizzle-orm"
import { db } from "../server/db"
import { githubApp, projects, user, verification } from "../server/db/schema"

const BASE_URL = process.env.TEST_BASE_URL ?? "http://localhost:3000"

export async function truncateDomain() {
  await db.execute(
    sql`TRUNCATE project_invitations, project_members, projects, "account", "session", "verification", "user" RESTART IDENTITY CASCADE`,
  )
  await db.execute(
    sql`UPDATE app_settings SET signup_gated = false, allowed_email_domains = '{}'::text[] WHERE id = 1`,
  )
}

/**
 * Seed a user directly in the DB. The email+password + sign-up flow was
 * removed when we switched to magic-link + OAuth, so tests can't bootstrap
 * a user via the auth API anymore. Inserting the row directly is faster,
 * doesn't hit auth rate limits, and skips the email-send side effect.
 */
export async function createUser(
  email: string,
  role: "admin" | "member" = "member",
): Promise<string> {
  const id = randomBytes(16).toString("hex")
  // Backdate createdAt 10s before updatedAt so the after-hook's "brand-new
  // user" heuristic doesn't misclassify this seeded row as a fresh sign-up
  // and silently promote a member-role test user to admin.
  const updatedAt = new Date()
  const createdAt = new Date(updatedAt.getTime() - 10_000)
  await db.insert(user).values({
    id,
    email,
    name: email.split("@")[0] ?? email,
    emailVerified: true,
    role,
    status: "active",
    createdAt,
    updatedAt,
  })
  return id
}

/**
 * Sign in via magic-link against the live dev server and return the session
 * cookie. The flow:
 *   1. POST /api/auth/sign-in/magic-link — better-auth generates a verification
 *      row in the `verification` table keyed by the crypto-random token.
 *   2. Fetch the most recent verification row for this email directly from the
 *      DB (we can't intercept the outgoing email in-process).
 *   3. GET /api/auth/magic-link/verify?token=... which sets the session cookie
 *      and redirects to the callbackURL.
 *   4. Extract the set-cookie header and return its name=value pair.
 *
 * This exercises the real magic-link code path end-to-end, including the
 * after-hook domain+invite gate. Tests that want to assert gate behavior
 * should configure `app_settings` before calling `signIn`.
 */
export async function signIn(email: string): Promise<string> {
  const sendRes = await fetch(`${BASE_URL}/api/auth/sign-in/magic-link`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, callbackURL: "/" }),
  })
  if (!sendRes.ok) {
    throw new Error(`magic-link send failed: ${sendRes.status} ${await sendRes.text()}`)
  }

  // The plugin stores the token as the `identifier` column (default storeToken
  // = "plain") and stashes `{ email, attempt }` in `value`. Pick the freshest
  // row whose value payload contains this email.
  const needle = `%"email":"${email}"%`
  const rows = await db
    .select({ identifier: verification.identifier })
    .from(verification)
    .where(sql`${verification.value} LIKE ${needle}`)
    .orderBy(desc(verification.createdAt))
    .limit(1)
  const firstRow = rows[0]
  if (!firstRow) {
    throw new Error(
      `signIn: no verification row found for ${email} — did /sign-in/magic-link succeed?`,
    )
  }
  const token = firstRow.identifier

  const verifyRes = await fetch(
    `${BASE_URL}/api/auth/magic-link/verify?token=${encodeURIComponent(token)}&callbackURL=/`,
    { redirect: "manual" },
  )
  if (verifyRes.status !== 200 && verifyRes.status !== 302) {
    throw new Error(
      `magic-link verify failed: ${verifyRes.status} ${await verifyRes.text()} for ${email}`,
    )
  }
  const cookie = verifyRes.headers.get("set-cookie") ?? ""
  // Extract just the session cookie part (strip Path, HttpOnly, etc. attributes)
  const match = /([^=]+=[^;]+)/.exec(cookie)
  return match ? match[1] : cookie
}

export async function apiFetch<T = unknown>(
  path: string,
  opts: RequestInit = {},
): Promise<{ status: number; body: T }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(opts.headers as Record<string, string>),
  }
  const res = await fetch(`${BASE_URL}${path}`, {
    ...opts,
    headers,
    body: opts.body
      ? typeof opts.body === "string"
        ? opts.body
        : JSON.stringify(opts.body)
      : undefined,
  })
  const text = await res.text()
  let body: T
  try {
    body = JSON.parse(text) as T
  } catch {
    body = text as unknown as T
  }
  return { status: res.status, body }
}

export async function truncateReports() {
  await db.execute(sql`TRUNCATE report_attachments, reports RESTART IDENTITY CASCADE`)
}

export async function seedProject(opts: {
  name: string
  publicKey: string
  allowedOrigins?: string[]
  createdBy: string
}): Promise<string> {
  const [p] = await db
    .insert(projects)
    .values({
      name: opts.name,
      createdBy: opts.createdBy,
      publicKey: opts.publicKey,
      allowedOrigins: opts.allowedOrigins ?? [],
    })
    .returning()
  return p.id
}

export async function truncateGithub() {
  await db.execute(sql`TRUNCATE report_sync_jobs, github_integrations RESTART IDENTITY CASCADE`)
}

export async function truncateSharedMedia() {
  await db.execute(sql`TRUNCATE shared_media RESTART IDENTITY CASCADE`)
}

export async function truncateGithubApp() {
  await db.execute(sql`TRUNCATE github_app RESTART IDENTITY CASCADE`)
}

/**
 * Seed the singleton `github_app` row with credentials that both the test
 * process and the running dev server can read. The tests used to rely on
 * `beforeAll` mutating `process.env.GITHUB_APP_*` — that works inside the
 * test process but the dev server (a separate process) captured an empty
 * env snapshot at startup, so integration endpoints kept returning
 * 401/500 "GitHub App is not configured". Writing to the DB is the one
 * channel both processes agree on.
 *
 * `encryptedText` columns lazy-read `ENCRYPTION_KEY` from `process.env`,
 * so this insert works as long as the key is present at call time
 * (which it is — both processes load the same root `.env`).
 */
export async function seedGithubApp(
  overrides: Partial<typeof githubApp.$inferInsert> = {},
): Promise<void> {
  const defaults = {
    id: 1,
    appId: "123",
    slug: "repro-test",
    privateKey: "-----BEGIN RSA PRIVATE KEY-----\ntest\n-----END RSA PRIVATE KEY-----",
    webhookSecret: "test-webhook-secret",
    clientId: "Iv1.test",
    clientSecret: "test-client-secret",
    htmlUrl: "https://github.com/apps/repro-test",
    createdBy: "test-bootstrap",
  }
  const values = { ...defaults, ...overrides }
  await db
    .insert(githubApp)
    .values(values)
    .onConflictDoUpdate({
      target: githubApp.id,
      set: {
        appId: values.appId,
        slug: values.slug,
        privateKey: values.privateKey,
        webhookSecret: values.webhookSecret,
        clientId: values.clientId,
        clientSecret: values.clientSecret,
        htmlUrl: values.htmlUrl,
        updatedAt: new Date(),
      },
    })
}

// Re-exported so magic-link tests can reach back into the user table without
// re-importing the schema themselves.
export { user, verification, eq }

/**
 * Brief sleep to let the in-process GitHub sync trigger settle. The trigger
 * fires after an enqueue (PATCH / intake / comment write) and runs
 * reconcileReport on the dashboard's side of the process. Tests that assert
 * `report_sync_jobs.state === 'pending'` need to wait until the trigger has
 * either succeeded (row gone) or failed-with-backoff (state back to
 * 'pending' with attempts>0) — without it the assertion can catch the row
 * mid-transition at state='syncing'.
 *
 * 500ms is generous vs. a typical trigger (<50ms) but covers slow CI runs.
 */
export async function waitForSyncTriggerSettle(ms = 500): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

export function makePngBlob(): Blob {
  // Minimal valid 1x1 PNG (signature + IHDR + IDAT + IEND)
  const bytes = new Uint8Array([
    137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0,
    0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 0, 1, 0, 0, 5, 0, 1, 13, 10,
    45, 180, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
  ])
  return new Blob([bytes], { type: "image/png" })
}
