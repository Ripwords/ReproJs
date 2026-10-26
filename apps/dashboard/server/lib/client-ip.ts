import type { H3Event } from "h3"
import { getHeader, getRequestIP } from "h3"
import { env } from "./env"

let warnedAboutUntrustedXff = false

/**
 * Client IP for the public intake endpoints' per-IP rate limiter.
 *
 * TRUST_XFF is OFF by default — a public deployment must not be trivially
 * rate-limit-bypassed via a spoofed X-Forwarded-For header. The flip side is
 * the missed-setup-step hazard: behind a reverse proxy that *does* set the
 * header, leaving TRUST_XFF=false means every visitor is seen as the proxy's
 * address and the whole install shares one bucket. Log that loudly, once,
 * the first time it is observed instead of silently 429ing real users.
 */
export function getClientIp(event: H3Event): string {
  const ip = getRequestIP(event, { xForwardedFor: env.TRUST_XFF }) ?? "unknown"
  if (!env.TRUST_XFF && !warnedAboutUntrustedXff && getHeader(event, "x-forwarded-for")) {
    warnedAboutUntrustedXff = true
    console.warn(
      [
        "[rate-limit] X-Forwarded-For is present on incoming requests but TRUST_XFF=false (the default).",
        `This install appears to sit behind a reverse proxy, so every client is seen as "${ip}" and`,
        `ALL of them share one per-IP intake bucket (INTAKE_RATE_PER_IP=${env.INTAKE_RATE_PER_IP}/min).`,
        "If the proxy overwrites X-Forwarded-For with the real client address, set TRUST_XFF=true.",
        "See docs/self-hosting/reverse-proxy. Logged once per process.",
      ].join(" "),
    )
  }
  return ip
}
