import { createError, defineEventHandler, getRequestIP, setHeader } from "h3"
import { eq } from "drizzle-orm"
import { db } from "../../../db"
import { githubApp } from "../../../db/schema"
import { requireInstallAdmin } from "../../../lib/permissions"
import type { GithubOAuthCredentialsDTO } from "@reprojs/shared"

/**
 * Admin-only: reveals the GitHub App's OAuth client_id + client_secret so the
 * operator can paste them into `.env` as GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET
 * and restart to enable better-auth GitHub sign-in.
 *
 * `client_secret` is decrypted on read by Drizzle's `encryptedText` custom
 * type; `client_id` is plaintext at rest (non-secret public identifier).
 * `Cache-Control: no-store` is defense-in-depth — the route is auth-gated, but
 * a secret must never be cacheable by any intermediary. Every successful reveal
 * emits a structured `console.info` audit line so operators with a log
 * collector can answer "who saw this secret, when, from where".
 */
export default defineEventHandler(async (event): Promise<GithubOAuthCredentialsDTO> => {
  const session = await requireInstallAdmin(event)

  const [row] = await db.select().from(githubApp).where(eq(githubApp.id, 1)).limit(1)
  if (!row) {
    throw createError({ statusCode: 404, statusMessage: "GitHub App not connected" })
  }

  setHeader(event, "Cache-Control", "no-store")

  console.info(
    JSON.stringify({
      event: "github_oauth_credential_reveal",
      userId: session.userId,
      ip: getRequestIP(event, { xForwardedFor: true }) ?? null,
      ts: new Date().toISOString(),
    }),
  )

  return {
    clientId: row.clientId,
    clientSecret: row.clientSecret,
  }
})
