import { createHmac, timingSafeEqual } from "node:crypto"

interface TokenInput {
  secret: string
  projectId: string
  reportId: string
  kind: string
  expiresAt: number // UNIX seconds
}

interface VerifyInput extends TokenInput {
  token: string
}

function canonicalPayload(p: Omit<TokenInput, "secret">): string {
  return `${p.projectId}:${p.reportId}:${p.kind}:${p.expiresAt}`
}

export function signAttachmentToken(input: TokenInput): string {
  const hmac = createHmac("sha256", input.secret)
  hmac.update(canonicalPayload(input))
  return hmac.digest("hex")
}

export function verifyAttachmentToken(input: VerifyInput): boolean {
  if (input.expiresAt * 1000 < Date.now()) return false
  const expected = signAttachmentToken(input)
  if (expected.length !== input.token.length) return false
  try {
    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(input.token, "hex"))
  } catch {
    return false
  }
}

/**
 * Verify against several secrets (current + retired). Every candidate is
 * checked so the time taken does not reveal which secret matched.
 */
export function verifyAttachmentTokenAny(
  input: Omit<VerifyInput, "secret"> & { secrets: readonly string[] },
): boolean {
  let ok = false
  for (const secret of input.secrets) {
    if (verifyAttachmentToken({ ...input, secret })) ok = true
  }
  return ok
}

// Helper used by callers to build the full signed URL.
export function buildSignedAttachmentUrl(params: {
  baseUrl: string
  projectId: string
  reportId: string
  kind: string
  secret: string
  ttlSeconds: number
}): string {
  const expiresAt = Math.floor(Date.now() / 1000) + params.ttlSeconds
  const token = signAttachmentToken({
    secret: params.secret,
    projectId: params.projectId,
    reportId: params.reportId,
    kind: params.kind,
    expiresAt,
  })
  const path = `/api/projects/${params.projectId}/reports/${params.reportId}/attachment`
  return `${params.baseUrl}${path}?kind=${encodeURIComponent(params.kind)}&token=${token}&expires=${expiresAt}`
}
