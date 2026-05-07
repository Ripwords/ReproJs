import { defineEventHandler } from "h3"
import { eq, desc } from "drizzle-orm"
import { db } from "../../db"
import { oauthConsent, oauthClient, oauthAccessToken } from "../../db/schema/auth-schema"
import { requireSession } from "../../lib/permissions"

/**
 * Returns the OAuth consents (= connected MCP apps) for the current user.
 * Each entry includes the client name (from RFC 7591 registration), connected
 * date, last-used timestamp, and the scopes granted.
 */
export default defineEventHandler(async (event) => {
  const session = await requireSession(event)

  const consents = await db
    .select({
      clientId: oauthConsent.clientId,
      scopes: oauthConsent.scopes,
      createdAt: oauthConsent.createdAt,
      clientName: oauthClient.name,
    })
    .from(oauthConsent)
    .innerJoin(oauthClient, eq(oauthClient.clientId, oauthConsent.clientId))
    .where(eq(oauthConsent.userId, session.userId))
    .orderBy(desc(oauthConsent.createdAt))

  // Last-used per client = latest access token's createdAt for that (user, client) pair.
  const lastUsedByClient = new Map<string, Date>()
  const lastUsedResults = await Promise.all(
    consents.map((c) =>
      db
        .select({ createdAt: oauthAccessToken.createdAt })
        .from(oauthAccessToken)
        .where(eq(oauthAccessToken.clientId, c.clientId))
        .orderBy(desc(oauthAccessToken.createdAt))
        .limit(1)
        .then((rows) => ({ clientId: c.clientId, createdAt: rows[0]?.createdAt ?? null })),
    ),
  )
  for (const r of lastUsedResults) {
    if (r.createdAt) lastUsedByClient.set(r.clientId, r.createdAt)
  }

  return {
    connections: consents.map((c) => ({
      clientId: c.clientId,
      clientName: c.clientName ?? "Unknown",
      scopes: c.scopes ?? [],
      connectedAt: c.createdAt,
      lastUsedAt: lastUsedByClient.get(c.clientId) ?? null,
    })),
  }
})
