import { env } from "./env"

export interface RateLimiterOptions {
  perMinute: number
  now?: () => number
}

export interface TakeResult {
  allowed: boolean
  retryAfterMs: number
}

export interface RateLimiter {
  take(key: string): Promise<TakeResult>
}

interface Bucket {
  tokens: number
  lastRefillMs: number
}

const WINDOW_MS = 60_000

/**
 * In-process token-bucket limiter. Lost on restart; per-worker under cluster.
 * Fine for single-process self-hosted deployments. For multi-process or
 * container-orchestrated setups, set `RATE_LIMIT_STORE=postgres` to use the
 * Postgres-backed limiter in rate-limit-pg.ts instead.
 */
export function createInProcessRateLimiter(opts: RateLimiterOptions): RateLimiter & {
  _sweep: () => void
  _size: () => number
} {
  const { perMinute } = opts
  const now = opts.now ?? (() => Date.now())
  const buckets = new Map<string, Bucket>()

  const sweep = () => {
    const t = now()
    for (const [k, b] of buckets) {
      if (t - b.lastRefillMs > WINDOW_MS * 10) buckets.delete(k)
    }
  }

  return {
    async take(key: string): Promise<TakeResult> {
      const t = now()
      let b = buckets.get(key)
      if (!b) {
        b = { tokens: perMinute - 1, lastRefillMs: t }
        buckets.set(key, b)
        return { allowed: true, retryAfterMs: 0 }
      }
      const elapsed = t - b.lastRefillMs
      const refill = (elapsed / WINDOW_MS) * perMinute
      b.tokens = Math.min(perMinute, b.tokens + refill)
      b.lastRefillMs = t
      if (b.tokens >= 1) {
        b.tokens -= 1
        return { allowed: true, retryAfterMs: 0 }
      }
      const needed = 1 - b.tokens
      const retryAfterMs = Math.ceil((needed / perMinute) * WINDOW_MS)
      return { allowed: false, retryAfterMs }
    },
    _sweep: sweep,
    _size: () => buckets.size,
  }
}

let _keyLimiter: RateLimiter | null = null
let _ipLimiter: RateLimiter | null = null
let _anonKeyLimiter: RateLimiter | null = null
let _inviteLimiter: RateLimiter | null = null
let _shareMintLimiter: RateLimiter | null = null

async function buildLimiter(perMinute: number): Promise<RateLimiter> {
  if (env.RATE_LIMIT_STORE === "postgres") {
    const { createPgRateLimiter } = await import("./rate-limit-pg")
    return createPgRateLimiter({ perMinute })
  }
  return createInProcessRateLimiter({ perMinute })
}

export async function getKeyLimiter(): Promise<RateLimiter> {
  if (!_keyLimiter) {
    _keyLimiter = await buildLimiter(env.INTAKE_RATE_PER_KEY)
  }
  return _keyLimiter
}

export async function getIpLimiter(): Promise<RateLimiter> {
  if (!_ipLimiter) {
    _ipLimiter = await buildLimiter(env.INTAKE_RATE_PER_IP)
  }
  return _ipLimiter
}

export async function getAnonKeyLimiter(): Promise<RateLimiter> {
  if (!_anonKeyLimiter) {
    _anonKeyLimiter = await buildLimiter(env.INTAKE_RATE_PER_KEY_ANON)
  }
  return _anonKeyLimiter
}

/**
 * Limiter for invitation-style flows that trigger email delivery on every
 * call (POST /api/users — admin invites, etc.). A compromised or careless
 * admin account could otherwise loop on send and exhaust SMTP quota / damage
 * sender reputation. Keyed on admin user-id, 5 sends / minute by default.
 */
export async function getInviteLimiter(): Promise<RateLimiter> {
  if (!_inviteLimiter) {
    _inviteLimiter = await buildLimiter(env.INVITE_RATE_PER_ADMIN)
  }
  return _inviteLimiter
}

/**
 * Limiter for the public share-link mint endpoint (POST /api/intake/media).
 * Keyed per-project (`share:${project.id}`) so one project minting share
 * links can't burn another project's quota. Low default (2/min) since
 * minting is a deliberate reporter action, not a high-frequency call.
 */
export async function getShareMintLimiter(): Promise<RateLimiter> {
  if (!_shareMintLimiter) {
    _shareMintLimiter = await buildLimiter(env.SHARE_MINTS_PER_MINUTE)
  }
  return _shareMintLimiter
}
