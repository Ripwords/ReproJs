// apps/dashboard/server/lib/shared-media-purge.ts
// Nightly retention sweep for shared_media rows (Task 9's public video-share
// links). Two independent triggers make a row eligible for purge:
//   - expires_at has passed (natural TTL), or
//   - the link was explicitly revoked (see shared-media admin DELETE) and
//     the revoke happened more than 24h ago.
// The 24h grace window on revoke exists so a just-revoked row is still
// visible/debuggable in the admin UI for a day before its blob is reclaimed.
import { and, eq, isNotNull, lt, or } from "drizzle-orm"
import { db } from "../db"
import { sharedMedia } from "../db/schema"
import { getStorage } from "./storage"

const REVOKED_GRACE_MS = 24 * 60 * 60 * 1000

/**
 * Delete shared_media rows (and their storage blobs) that are expired or
 * were revoked more than 24h ago.
 *
 * Boundary semantics: a row revoked *exactly* 24h before `now` is NOT
 * purged — the condition is strict `<` on `revoked_at < now - 24h`, so the
 * row must be older than the grace window, not merely at its edge.
 *
 * Per row: storage.delete() runs in its own try/catch — a blob that's
 * already missing (or a storage backend error) must never block the row
 * from being deleted, otherwise a corrupt/missing blob would wedge the
 * purge forever on the same row.
 */
export async function purgeSharedMedia(now = new Date()): Promise<{ purged: number }> {
  const revokedGraceCutoff = new Date(now.getTime() - REVOKED_GRACE_MS)

  const candidates = await db
    .select({ id: sharedMedia.id, storageKey: sharedMedia.storageKey })
    .from(sharedMedia)
    .where(
      or(
        lt(sharedMedia.expiresAt, now),
        and(isNotNull(sharedMedia.revokedAt), lt(sharedMedia.revokedAt, revokedGraceCutoff)),
      ),
    )

  if (candidates.length === 0) return { purged: 0 }

  const storage = await getStorage()
  let purged = 0
  for (const row of candidates) {
    try {
      await storage.delete(row.storageKey)
    } catch {
      // Blob already gone (or backend hiccup) — must not block row deletion.
    }
    await db.delete(sharedMedia).where(eq(sharedMedia.id, row.id))
    purged++
  }

  return { purged }
}
