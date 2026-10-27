import { getGithubAppCredentials } from "./github-app-credentials"

/** The subset of a GitHub comment author needed to recognise our own App. */
export type GithubCommentAuthor = { login: string; type?: string | null } | null | undefined

/**
 * True only when the comment was authored by this deployment's GitHub App
 * (GitHub reports App comments as `type: "Bot"` under `<slug>[bot]`). Used to
 * recognise our own report-body comment by its marker, both on inbound webhook
 * echoes and when the reconciler scans an issue before posting. A human
 * pasting the marker text must never be mistaken for us.
 */
export async function isOurBotComment(user: GithubCommentAuthor): Promise<boolean> {
  if (!user || user.type !== "Bot") return false
  const creds = await getGithubAppCredentials()
  if (!creds?.slug) return false
  return user.login === `${creds.slug}[bot]`
}
