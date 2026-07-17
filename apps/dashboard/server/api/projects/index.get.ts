import { defineEventHandler } from "h3"
import { and, desc, eq, isNull } from "drizzle-orm"
import type { ProjectDTO, ProjectRole } from "@reprojs/shared"
import { db } from "../../db"
import { projectMembers, projects } from "../../db/schema"
import { requireSession } from "../../lib/permissions"

export default defineEventHandler(async (event): Promise<ProjectDTO[]> => {
  const session = await requireSession(event)

  if (session.role === "admin") {
    const rows = await db
      .select()
      .from(projects)
      .where(isNull(projects.deletedAt))
      .orderBy(desc(projects.createdAt))

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      createdBy: r.createdBy,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      effectiveRole: "owner",
      publicKey: r.publicKey,
      allowedOrigins: r.allowedOrigins,
      dailyReportCap: r.dailyReportCap,
      replayEnabled: r.replayEnabled,
      shareLinksEnabled: r.shareLinksEnabled,
      shareRetentionDays: r.shareRetentionDays,
    }))
  }

  const rows = await db
    .select({
      id: projects.id,
      name: projects.name,
      createdBy: projects.createdBy,
      createdAt: projects.createdAt,
      updatedAt: projects.updatedAt,
      role: projectMembers.role,
      publicKey: projects.publicKey,
      allowedOrigins: projects.allowedOrigins,
      dailyReportCap: projects.dailyReportCap,
      replayEnabled: projects.replayEnabled,
      shareLinksEnabled: projects.shareLinksEnabled,
      shareRetentionDays: projects.shareRetentionDays,
    })
    .from(projects)
    .innerJoin(projectMembers, eq(projectMembers.projectId, projects.id))
    .where(and(eq(projectMembers.userId, session.userId), isNull(projects.deletedAt)))
    .orderBy(desc(projects.createdAt))

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    createdBy: r.createdBy,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    effectiveRole: r.role as ProjectRole,
    publicKey: r.publicKey,
    allowedOrigins: r.allowedOrigins,
    dailyReportCap: r.dailyReportCap,
    replayEnabled: r.replayEnabled,
    shareLinksEnabled: r.shareLinksEnabled,
    shareRetentionDays: r.shareRetentionDays,
  }))
})
