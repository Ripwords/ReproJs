/**
 * The workspace email-domain allowlist, as one rule shared by sign-in
 * (server/lib/auth.ts) and every invite endpoint. Keeping a single copy is
 * the point: when invites checked the allowlist only while sign-up was
 * gated, an admin could invite an address that sign-in then refused.
 */

export function emailDomain(email: string): string {
  return email.toLowerCase().split("@")[1] ?? ""
}

/** True when the allowlist is empty (no restriction) or holds the email's domain. */
export function isEmailDomainOnAllowlist(
  email: string,
  allowedDomains: readonly string[],
): boolean {
  if (allowedDomains.length === 0) return true
  return allowedDomains.includes(emailDomain(email))
}
