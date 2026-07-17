import { createError, defineEventHandler, getRouterParam, readValidatedBody } from "h3"
import { eq } from "drizzle-orm"
import { UpdateProjectInput } from "@reprojs/shared"
import { db } from "../../../db"
import { projects } from "../../../db/schema"
import { requireProjectRole } from "../../../lib/permissions"

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id")
  if (!id) throw createError({ statusCode: 400, statusMessage: "missing project id" })
  await requireProjectRole(event, id, "owner")
  const body = await readValidatedBody(event, (b: unknown) => UpdateProjectInput.parse(b))

  const [updated] = await db
    .update(projects)
    .set({
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.allowedOrigins !== undefined ? { allowedOrigins: body.allowedOrigins } : {}),
      ...(body.dailyReportCap !== undefined ? { dailyReportCap: body.dailyReportCap } : {}),
      ...(body.replayEnabled !== undefined ? { replayEnabled: body.replayEnabled } : {}),
      ...(body.shareLinksEnabled !== undefined
        ? { shareLinksEnabled: body.shareLinksEnabled }
        : {}),
      ...(body.shareRetentionDays !== undefined
        ? { shareRetentionDays: body.shareRetentionDays }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(projects.id, id))
    .returning()

  if (!updated) throw createError({ statusCode: 404, statusMessage: "Project not found" })

  return {
    id: updated.id,
    name: updated.name,
    createdBy: updated.createdBy,
    createdAt: updated.createdAt.toISOString(),
    updatedAt: updated.updatedAt.toISOString(),
    effectiveRole: "owner" as const,
    publicKey: updated.publicKey,
    allowedOrigins: updated.allowedOrigins,
    dailyReportCap: updated.dailyReportCap,
    replayEnabled: updated.replayEnabled,
    shareLinksEnabled: updated.shareLinksEnabled,
    shareRetentionDays: updated.shareRetentionDays,
  }
})
