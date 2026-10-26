import type { H3Event } from "h3"
import { getHeader, setHeaders } from "h3"
import { normalizeOrigin } from "@reprojs/shared"
import { env } from "./env"

/**
 * Headers for the CORS preflight (OPTIONS) on the intake endpoint.
 * Safe to reflect the request Origin here: preflights don't expose response
 * bodies to cross-origin scripts on their own — they only tell the browser
 * that a subsequent real request will pass CORS. Emitting ACAO here lets the
 * browser proceed; the real security check happens on the POST response,
 * where we only emit ACAO AFTER the origin passes the project's allowlist.
 */
export function applyIntakePreflightCors(event: H3Event) {
  const origin = getHeader(event, "origin") ?? "*"
  setHeaders(event, {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  })
}

/**
 * Emit ACAO + Vary on a real response AFTER the origin has been validated
 * against the target project's allowlist. Before validation we deliberately
 * do NOT emit ACAO, so cross-origin scripts cannot read error response bodies
 * (e.g. "Invalid project key") and use them as an enumeration oracle.
 */
export function applyIntakePostCors(event: H3Event, allowedOrigin: string) {
  setHeaders(event, {
    "Access-Control-Allow-Origin": allowedOrigin,
    Vary: "Origin",
  })
}

/**
 * Returns true if `origin` is accepted by the project's allow-list.
 *
 * Empty allow-list = reject everything in production. The previous
 * "empty allow-list + localhost passes" leniency ran regardless of
 * environment, which meant a production deployment where the operator
 * hadn't configured any origins silently accepted any localhost-origin
 * intake — and since the project key alone identifies the project, that
 * was effectively an open endpoint whenever an attacker ran the SDK
 * from a localhost page (file://, http://127.0.0.1/, a tunneled dev
 * server, etc.).
 *
 * New contract:
 *   - Non-empty allow-list → must contain the origin exactly.
 *   - Empty allow-list in development → localhost / 127.0.0.1 passes
 *     (so first-time local SDK testing doesn't require config).
 *   - Empty allow-list in production → always reject. Operators must
 *     set `allowedOrigins` on each project before it can receive
 *     reports.
 */
export function isOriginAllowed(
  origin: string | null | undefined,
  allowed: string[],
  opts?: { allowEmpty?: boolean },
): boolean {
  if (!origin) return opts?.allowEmpty === true
  if (allowed.length > 0) {
    // Exact match on canonical origins. Browsers already send a canonical
    // `Origin`; normalising both sides covers allow-list rows written before
    // project settings normalised on save (trailing slash, path, mixed case)
    // and the extension's X-Repro-Origin fallback.
    const wanted = normalizeOrigin(origin)
    if (!wanted) return false
    return allowed.some((entry) => normalizeOrigin(entry) === wanted)
  }
  if (env.NODE_ENV !== "development") return false
  try {
    const u = new URL(origin)
    return u.hostname === "localhost" || u.hostname === "127.0.0.1"
  } catch {
    return false
  }
}
