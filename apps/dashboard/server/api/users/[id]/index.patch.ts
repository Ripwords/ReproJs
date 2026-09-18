import { createError, defineEventHandler, getRouterParam, readValidatedBody } from "h3"
import { count, eq } from "drizzle-orm"
import { UpdateUserInput } from "@reprojs/shared"
import { db } from "../../../db"
import { user } from "../../../db/schema"
import { requireInstallAdmin } from "../../../lib/permissions"
import { endSessionsOfDisabledUser } from "../../../lib/session-ended"

export default defineEventHandler(async (event) => {
  await requireInstallAdmin(event)
  const id = getRouterParam(event, "id")
  if (!id) throw createError({ statusCode: 400, statusMessage: "missing id" })
  const body = await readValidatedBody(event, (b: unknown) => UpdateUserInput.parse(b))

  const [target] = await db.select().from(user).where(eq(user.id, id))
  if (!target) {
    throw createError({ statusCode: 404, statusMessage: "User not found" })
  }

  // Last-admin guard: cannot demote the last admin or disable the last admin.
  const wouldLoseAdmin =
    (body.role === "member" && target.role === "admin") ||
    (body.status === "disabled" && target.role === "admin" && target.status !== "disabled")
  if (wouldLoseAdmin) {
    const [countRow] = await db.select({ c: count() }).from(user).where(eq(user.role, "admin"))
    const c = countRow?.c ?? 0
    if (c <= 1) {
      throw createError({
        statusCode: 409,
        statusMessage: "Cannot demote or disable the last admin",
      })
    }
  }

  const updates: Partial<typeof target> = {}
  if (body.role !== undefined) updates.role = body.role
  if (body.status !== undefined) updates.status = body.status

  const updated = await db.transaction(async (tx) => {
    const [row] = await tx.update(user).set(updates).where(eq(user.id, id)).returning()
    // A disabled user must be signed out everywhere now, not when their
    // sessions happen to expire. requireSession already refuses them, but a
    // live session left them clicking through 403 toasts and "project not
    // found" redirects with no idea why.
    if (row && body.status === "disabled") await endSessionsOfDisabledUser(tx, id)
    return row
  })
  if (!updated) {
    throw createError({ statusCode: 500, statusMessage: "Insert failed" })
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
