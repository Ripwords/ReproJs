// packages/shared/src/related-issue.ts
//
// Reporter-typed reference to an existing GitHub issue. Shared by the widget
// (client-side hint), the intake API (what gets stored) and the dashboard
// (paste box in the attach dialog), so all three agree on what counts as an
// issue reference. Only the number is kept: the project's configured repo is
// the only place a report can be attached, so owner/repo in the input is
// informational.

/** GitHub issue numbers are well below this; anything larger is a typo. */
export const MAX_ISSUE_NUMBER = 10_000_000

const BARE_NUMBER = /^#?(\d+)$/
const SHORTHAND = /^[\w.-]+\/[\w.-]+#(\d+)$/
const GH_PREFIX = /^GH-(\d+)$/i
const ISSUE_URL =
  /^(?:https?:\/\/)?(?:www\.)?github\.com\/[\w.-]+\/[\w.-]+\/issues\/(\d+)\/?(?:[?#].*)?$/i

/**
 * Returns the issue number named by `input`, or null when the text is not an
 * issue reference. Pull-request URLs are rejected on purpose: a report cannot
 * be attached to a PR.
 */
export function parseRelatedIssueNumber(input: string): number | null {
  const text = input.trim()
  if (!text) return null
  const match =
    BARE_NUMBER.exec(text) ?? SHORTHAND.exec(text) ?? GH_PREFIX.exec(text) ?? ISSUE_URL.exec(text)
  const digits = match?.[1]
  if (!digits) return null
  const n = Number(digits)
  if (!Number.isSafeInteger(n) || n < 1 || n > MAX_ISSUE_NUMBER) return null
  return n
}
