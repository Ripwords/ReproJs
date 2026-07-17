import { createError, defineEventHandler, getRequestURL, getRouterParam } from "h3"
import { desc, eq } from "drizzle-orm"
import type { SharedMediaDTO } from "@reprojs/shared"
import { db } from "../../../../db"
import { sharedMedia } from "../../../../db/schema"
import { requireProjectRole } from "../../../../lib/permissions"

export default defineEventHandler(async (event): Promise<SharedMediaDTO[]> => {
  const id = getRouterParam(event, "id")
  if (!id) throw createError({ statusCode: 400, statusMessage: "missing project id" })
  await requireProjectRole(event, id, "manager")

  const rows = await db
    .select()
    .from(sharedMedia)
    .where(eq(sharedMedia.projectId, id))
    .orderBy(desc(sharedMedia.createdAt))

  const origin = getRequestURL(event).origin
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    mime: row.mime,
    sizeBytes: row.sizeBytes,
    durationMs: row.durationMs,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
    shareUrl: `${origin}/s/${row.token}`,
  }))
})
