/**
 * Canonical origin for an allow-list entry, matching what a browser puts in
 * the `Origin` request header: lower-cased scheme + host, default port
 * dropped, no path / query / fragment / userinfo.
 *
 *   normalizeOrigin("HTTPS://App.Example.com:443/dashboard/") → "https://app.example.com"
 *
 * Returns `null` when the input is not an absolute URL with a usable origin
 * (relative paths, `file:` URLs, garbage). Callers decide whether that is a
 * validation error (project settings) or simply "not allowed" (intake).
 */
export function normalizeOrigin(input: string): string | null {
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    return null
  }
  if (url.origin && url.origin !== "null") return url.origin
  // Non-special schemes (chrome-extension:, moz-extension:, …) report an
  // opaque "null" origin from the URL parser even though they carry a host.
  // Rebuild scheme://host by hand so an extension id still round-trips.
  if (!url.host) return null
  return `${url.protocol}//${url.host}`.toLowerCase()
}
