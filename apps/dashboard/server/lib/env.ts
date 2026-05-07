import { z } from "zod"

// ---------------------------------------------------------------------------
// Zod-validated env singleton.
//
// Every server module imports `env` (and the derived exports below) from this
// file instead of reading `process.env.*` directly. The schema is parsed once
// at import time: if a required secret is missing or a typed value is
// malformed, we fail fast with a human-readable error.
//
// Tests must set env vars BEFORE the subject-under-test imports this module.
// Runtime mutation of `process.env` has no effect on the validated `env`
// object. See `_reloadEnvForTesting` for the escape hatch.
// ---------------------------------------------------------------------------

const boolString = z.enum(["true", "false"]).transform((v) => v === "true")

const intString = (defaultValue: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? defaultValue : Number(v)))
    .pipe(z.number().int())

const Schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  BETTER_AUTH_URL: z.url().default("http://localhost:3000"),
  BETTER_AUTH_SECRET: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  ATTACHMENT_URL_SECRET: z.string().min(1),
  // Base64-encoded 32-byte key used by `encryptedText` columns (AES-256-GCM
  // via HKDF). Generate with `openssl rand -base64 32`. Required iff any
  // encrypted row is written — we keep it optional so local/dev tooling that
  // never touches encrypted tables doesn't need it set. The custom type
  // throws a clear error at first encrypted read/write if it's missing.
  ENCRYPTION_KEY: z.string().optional().default(""),

  // DB pool
  DB_POOL_MAX: intString(10),
  DB_STATEMENT_TIMEOUT_MS: intString(30_000),
  DB_IDLE_TX_TIMEOUT_MS: intString(10_000),

  // OAuth providers — all optional
  GITHUB_CLIENT_ID: z.string().optional().default(""),
  GITHUB_CLIENT_SECRET: z.string().optional().default(""),
  GOOGLE_CLIENT_ID: z.string().optional().default(""),
  GOOGLE_CLIENT_SECRET: z.string().optional().default(""),

  // GitHub App
  GITHUB_APP_ID: z.string().optional().default(""),
  GITHUB_APP_PRIVATE_KEY: z.string().optional().default(""),
  GITHUB_APP_WEBHOOK_SECRET: z.string().optional().default(""),
  GITHUB_APP_SLUG: z.string().default("repro"),
  GITHUB_APP_CLIENT_ID: z.string().optional().default(""),
  GITHUB_APP_CLIENT_SECRET: z.string().optional().default(""),
  GITHUB_WEBHOOK_MAX_BYTES: intString(1_048_576),

  // Mail
  MAIL_PROVIDER: z.enum(["console", "ethereal", "smtp"]).default("console"),
  SMTP_HOST: z.string().optional().default(""),
  SMTP_PORT: intString(587),
  SMTP_USER: z.string().optional().default(""),
  SMTP_PASS: z.string().optional().default(""),
  SMTP_FROM: z.string().default("Repro <no-reply@localhost>"),

  // Storage
  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  STORAGE_LOCAL_ROOT: z.string().default("./.data/attachments"),
  S3_ENDPOINT: z.string().optional().default(""),
  S3_BUCKET: z.string().default("repro-attachments"),
  S3_REGION: z.string().default("us-east-1"),
  S3_ACCESS_KEY_ID: z.string().optional().default(""),
  S3_SECRET_ACCESS_KEY: z.string().optional().default(""),
  S3_VIRTUAL_HOSTED: boolString.default(false),

  // Intake tuning
  INTAKE_RATE_PER_KEY: intString(60),
  INTAKE_RATE_PER_IP: intString(20),
  INTAKE_RATE_PER_KEY_ANON: intString(10),
  INTAKE_MAX_BYTES: intString(5_242_880),
  INTAKE_USER_FILE_MAX_BYTES: intString(10 * 1024 * 1024),
  INTAKE_USER_FILES_TOTAL_MAX_BYTES: intString(25 * 1024 * 1024),
  INTAKE_USER_FILES_MAX_COUNT: intString(5),

  // Virus scanning for user-supplied attachments. When ENABLED is false
  // (the default) the scan path is skipped entirely so self-hosters who
  // don't run a ClamAV sidecar aren't impacted. When true, intake fails
  // closed: a scanner outage rejects uploads rather than silently letting
  // unscanned files through.
  INTAKE_USER_FILE_SCAN_ENABLED: boolString.default(false),
  CLAMAV_HOST: z.string().default("localhost"),
  CLAMAV_PORT: intString(3310),
  CLAMAV_TIMEOUT_MS: intString(30_000),
  INTAKE_REQUIRE_DWELL: boolString.default(true),
  INTAKE_MIN_DWELL_MS: intString(1_500),

  // Session replay
  REPLAY_FEATURE_ENABLED: boolString.default(true),
  INTAKE_REPLAY_MAX_BYTES: intString(1_048_576),

  // MCP — feature gate + tunables. Default-on as of v0.6.0. Operators who
  // want to disable MCP entirely can set MCP_ENABLED=false; that hides the
  // /api/mcp route + discovery endpoints + oauth-provider plugin without
  // touching the dashboard's other auth flows.
  MCP_ENABLED: boolString.default(true),
  MCP_ACCESS_TOKEN_TTL_SECONDS: intString(3600),
  MCP_RATE_LIMIT_PER_USER_PER_MINUTE: intString(600),

  // Auth rate limit — tri-state: explicit true/false overrides the
  // production-default. Represented as optional so the derived
  // `authRateLimitEnabled` export can distinguish "unset" from "false".
  AUTH_RATE_LIMIT_ENABLED: boolString.optional(),
  AUTH_RATE_PER_IP_PER_15MIN: intString(5),

  // Invite limiter — caps invitation-style flows that dispatch email per
  // call (POST /api/users). 5 sends/min/admin is enough for bulk invites
  // typed by hand; a runaway loop hits the cap before burning SMTP quota.
  INVITE_RATE_PER_ADMIN: intString(5),

  RATE_LIMIT_STORE: z.enum(["memory", "postgres"]).default("memory"),
  TRUST_XFF: boolString.default(false),
  SDK_PATH: z.string().optional().default(""),
})

function parseEnv(): z.infer<typeof Schema> {
  const result = Schema.safeParse(process.env)
  if (!result.success) {
    console.error("Invalid environment configuration:")
    for (const issue of result.error.issues) {
      console.error(`  ${issue.path.join(".")}: ${issue.message}`)
    }
    throw new Error("Invalid environment configuration — see errors above")
  }
  return result.data
}

// Mutable binding so `_reloadEnvForTesting` can swap the parsed snapshot.
// Callers always import `env` (not a destructured field) so they observe the
// current snapshot, not a stale one captured at module-init time.
// eslint-disable-next-line import/no-mutable-exports
export let env: z.infer<typeof Schema> = parseEnv()
export type Env = typeof env

/**
 * Effective value of AUTH_RATE_LIMIT_ENABLED:
 *   - If explicitly set to "true" or "false", use that.
 *   - Otherwise enable in production, disable in dev/test.
 *
 * Exposed as a getter so tests that call `_reloadEnvForTesting` see the
 * up-to-date value without re-importing the module.
 */
export function getAuthRateLimitEnabled(): boolean {
  return env.AUTH_RATE_LIMIT_ENABLED ?? env.NODE_ENV === "production"
}

/**
 * Test-only: re-parse `process.env` and swap the exported `env` snapshot.
 * Needed for tests that mutate env vars at runtime (e.g. storage/s3.test.ts).
 */
export function _reloadEnvForTesting(): void {
  env = parseEnv()
}
