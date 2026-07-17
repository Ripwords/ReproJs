import { createError, defineEventHandler, getRouterParam } from "h3"
import { and, eq } from "drizzle-orm"
import { db } from "../../../../db"
import { sharedMedia } from "../../../../db/schema"
import { requireProjectRole } from "../../../../lib/permissions"

// Revokes a shared-media link. Idempotent: revoking an already-revoked row
// still returns 200 and leaves the original revokedAt untouched — callers
// shouldn't be able to "refresh" the revocation timestamp by calling twice.
// Scoped by projectId AND id together so a mediaId from another project
// 404s instead of leaking cross-project existence.
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id")
  if (!id) throw createError({ statusCode: 400, statusMessage: "missing project id" })
  const mediaId = getRouterParam(event, "mediaId")
  if (!mediaId) throw createError({ statusCode: 400, statusMessage: "missing mediaId" })
  await requireProjectRole(event, id, "manager")

  const [row] = await db
    .select()
    .from(sharedMedia)
    .where(and(eq(sharedMedia.id, mediaId), eq(sharedMedia.projectId, id)))
    .limit(1)
  if (!row) throw createError({ statusCode: 404, statusMessage: "Shared media not found" })

  if (!row.revokedAt) {
    await db
      .update(sharedMedia)
      .set({ revokedAt: new Date() })
      .where(and(eq(sharedMedia.id, mediaId), eq(sharedMedia.projectId, id)))
  }

  return { ok: true }
})
