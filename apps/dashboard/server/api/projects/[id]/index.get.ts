import { createError, defineEventHandler, getRouterParam } from "h3"
import { eq } from "drizzle-orm"
import { db } from "../../../db"
import { projects } from "../../../db/schema"
import { requireProjectRole } from "../../../lib/permissions"

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id")
  if (!id) throw createError({ statusCode: 400, statusMessage: "missing project id" })
  const { effectiveRole } = await requireProjectRole(event, id, "viewer")

  const [p] = await db.select().from(projects).where(eq(projects.id, id))
  if (!p || p.deletedAt) {
    throw createError({ statusCode: 404, statusMessage: "Project not found" })
  }

  return {
    id: p.id,
    name: p.name,
    createdBy: p.createdBy,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    effectiveRole,
    publicKey: p.publicKey,
    allowedOrigins: p.allowedOrigins,
    dailyReportCap: p.dailyReportCap,
    replayEnabled: p.replayEnabled,
    shareLinksEnabled: p.shareLinksEnabled,
    shareRetentionDays: p.shareRetentionDays,
  }
})
