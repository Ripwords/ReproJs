import { createError, defineEventHandler, getRouterParam, readValidatedBody } from "h3"
import { and, count, eq, sql } from "drizzle-orm"
import { UpdateUserInput } from "@reprojs/shared"
import { db } from "../../../db"
import { user } from "../../../db/schema"
import { requireInstallAdmin } from "../../../lib/permissions"
import { endSessionsOfDisabledUser } from "../../../lib/session-ended"

function isActiveAdmin(role: string | null, status: string | null): boolean {
  return role === "admin" && status === "active"
}

export default defineEventHandler(async (event) => {
  await requireInstallAdmin(event)
  const id = getRouterParam(event, "id")
  if (!id) throw createError({ statusCode: 400, statusMessage: "missing id" })
  const body = await readValidatedBody(event, (b: unknown) => UpdateUserInput.parse(b))

  const result = await db.transaction(async (tx) => {
    // Serialize role/status changes install-wide so the last-admin guard
    // can't be raced: two concurrent demotions would otherwise both count
    // two admins and both commit. Released at commit/rollback.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('users:admins'))`)

    const [target] = await tx.select().from(user).where(eq(user.id, id))
    if (!target) return { outcome: "not_found" as const }

    const nextRole = body.role ?? target.role
    const nextStatus = body.status ?? target.status
    // Only an active admin can sign in and run the install. A disabled or
    // never-signed-in admin doesn't count, or demoting the one admin who can
    // still sign in would lock everyone out of user management.
    if (isActiveAdmin(target.role, target.status) && !isActiveAdmin(nextRole, nextStatus)) {
      const [countRow] = await tx
        .select({ c: count() })
        .from(user)
        .where(and(eq(user.role, "admin"), eq(user.status, "active")))
      if ((countRow?.c ?? 0) <= 1) return { outcome: "last_admin" as const }
    }

    const [row] = await tx
      .update(user)
      .set({ role: nextRole, status: nextStatus })
      .where(eq(user.id, id))
      .returning()
    // A disabled user must be signed out everywhere now, not when their
    // sessions happen to expire. requireSession already refuses them, but a
    // live session left them clicking through 403 toasts and "project not
    // found" redirects with no idea why.
    if (row && body.status === "disabled") await endSessionsOfDisabledUser(tx, id)
    return { outcome: "updated" as const, row }
  })

  if (result.outcome === "not_found") {
    throw createError({ statusCode: 404, statusMessage: "User not found" })
  }
  if (result.outcome === "last_admin") {
    throw createError({
      statusCode: 409,
      statusMessage: "Cannot demote or disable the last active admin",
    })
  }
  const updated = result.row
  if (!updated) {
    throw createError({ statusCode: 500, statusMessage: "Update failed" })
  }

  return {
    id: updated.id,
    email: updated.email,
    name: updated.name ?? null,
    role: (updated.role ?? "member") as "admin" | "member",
    status: (updated.status ?? "active") as "invited" | "active" | "disabled",
    emailVerified: updated.emailVerified,
    createdAt: updated.createdAt.toISOString(),
  }
})
