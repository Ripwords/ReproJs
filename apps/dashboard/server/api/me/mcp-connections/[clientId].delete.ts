import { createError, defineEventHandler, getRouterParam } from "h3"
import { and, eq } from "drizzle-orm"
import { db } from "../../../db"
import { oauthConsent, oauthAccessToken, oauthRefreshToken } from "../../../db/schema/auth-schema"
import { requireSession } from "../../../lib/permissions"

/**
 * Revoke an MCP client's access for the current user. Deletes:
 *   1. The consent grant (so future authorize attempts will re-prompt)
 *   2. All access tokens for this (user, client) pair
 *   3. All refresh tokens for this (user, client) pair
 *
 * Idempotent — returns { revoked: false } if no consent existed.
 */
export default defineEventHandler(async (event) => {
  const session = await requireSession(event)
  const clientId = getRouterParam(event, "clientId")
  if (!clientId) throw createError({ statusCode: 400, statusMessage: "missing clientId" })

  return await db.transaction(async (tx) => {
    const deleted = await tx
      .delete(oauthConsent)
      .where(and(eq(oauthConsent.userId, session.userId), eq(oauthConsent.clientId, clientId)))
      .returning({ clientId: oauthConsent.clientId })
    if (deleted.length === 0) return { revoked: false }

    await tx
      .delete(oauthAccessToken)
      .where(
        and(eq(oauthAccessToken.userId, session.userId), eq(oauthAccessToken.clientId, clientId)),
      )
    await tx
      .delete(oauthRefreshToken)
      .where(
        and(eq(oauthRefreshToken.userId, session.userId), eq(oauthRefreshToken.clientId, clientId)),
      )
    return { revoked: true }
  })
})
