import type { Config } from "../types"

function safeOrigin(url: string): string | null {
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

/**
 * Host permissions that become unused once `removed` is gone. Only the page
 * origin is ever a candidate: the intake origin is shared by design (most
 * testers point every config at one dashboard) and is never revoked here.
 * The page origin is kept when any remaining config uses it either as its
 * own page origin or as its intake host — revoking it would silently break
 * that other config's injection or proxy fetch.
 */
export function permissionsToRevoke(removed: Config, remaining: readonly Config[]): string[] {
  const stillUsed = remaining.some(
    (c) => c.origin === removed.origin || safeOrigin(c.intakeEndpoint) === removed.origin,
  )
  return stillUsed ? [] : [removed.origin]
}

/**
 * Injection and the proxy both resolve a tab by exact origin and take the
 * first match, so a second config for the same origin can never be
 * selected — it would just confuse the tester about which project key is in
 * use. Refuse it up front.
 */
export function canAddConfig(
  origin: string,
  existing: readonly Config[],
): { ok: true } | { ok: false; message: string } {
  const dup = existing.find((c) => c.origin === origin)
  if (dup) {
    return {
      ok: false,
      message: `${origin} already has a config ("${dup.label}"). Remove it first to use a different project key.`,
    }
  }
  return { ok: true }
}
