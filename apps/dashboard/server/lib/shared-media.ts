import { eq } from "drizzle-orm"
import { db } from "../db"
import { sharedMedia } from "../db/schema"

/**
 * Look up a shared_media row by token, treating unknown, expired, and
 * revoked tokens identically (all return null). Callers MUST surface a
 * uniform 404 for every null case — the public share routes must not leak
 * which of the three states a given token is in.
 */
export async function findLiveSharedMedia(
  token: string,
): Promise<typeof sharedMedia.$inferSelect | null> {
  if (!token || token.length > 128) return null
  const [row] = await db.select().from(sharedMedia).where(eq(sharedMedia.token, token)).limit(1)
  if (!row) return null
  if (row.revokedAt) return null
  if (row.expiresAt.getTime() < Date.now()) return null
  return row
}
