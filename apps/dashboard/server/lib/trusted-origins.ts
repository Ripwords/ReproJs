/**
 * Parse BETTER_AUTH_TRUSTED_ORIGINS: extra origins, besides BETTER_AUTH_URL,
 * that better-auth accepts as a request Origin and as a redirect target.
 *
 * Needed when one install answers on more than one hostname (an internal and
 * a public name, or an old domain kept alive during a move). Without it,
 * sign-in from the second hostname fails better-auth's origin check.
 *
 * better-auth also reads this variable itself, but splits on "," without
 * trimming or checking, so a space after a comma or a missing scheme makes
 * an entry silently never match. Parsing it here fails fast at boot instead.
 */
export function parseTrustedOrigins(raw: string | undefined): string[] {
  if (!raw) return []
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map(toOrigin)
}

function toOrigin(entry: string): string {
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(entry)) {
    throw new Error(`"${entry}" needs a scheme, e.g. https://${entry}`)
  }
  // better-auth matches wildcard patterns itself; URL() would mangle them.
  if (entry.includes("*")) return entry.replace(/\/+$/, "")
  return new URL(entry).origin
}
