import { and, desc, eq } from "drizzle-orm"
import { defineEventHandler } from "h3"
import { db } from "../../db"
import { projectInvitations, projects, user } from "../../db/schema"
import { requireSession } from "../../lib/permissions"
import type { PendingInvitationDTO } from "@reprojs/shared"

// List the current user's pending invitations. Matched by normalized email
// (invitations are sent to an email, not a userId, so a user with an account
// under that address sees them here regardless of when the account existed
// relative to the invite).
//
// Invitations with status="pending" but a past expiresAt are filtered out
// client-side here — a background job (or the token-detail endpoint on
// visit) eventually flips them to status="expired", but this list should
// stay clean without waiting for that.
export default defineEventHandler(async (event): Promise<PendingInvitationDTO[]> => {
  const session = await requireSession(event)
  const emailLower = session.email.toLowerCase()
  const now = new Date()

  const rows = await db
    .select({
      token: projectInvitations.token,
      projectId: projectInvitations.projectId,
      projectName: projects.name,
      role: projectInvitations.role,
      inviterName: user.name,
      inviterEmail: user.email,
      invitedAt: projectInvitations.createdAt,
      expiresAt: projectInvitations.expiresAt,
    })
    .from(projectInvitations)
    .innerJoin(projects, eq(projects.id, projectInvitations.projectId))
    .innerJoin(user, eq(user.id, projectInvitations.invitedBy))
    .where(and(eq(projectInvitations.email, emailLower), eq(projectInvitations.status, "pending")))
    .orderBy(desc(projectInvitations.createdAt))

  return rows
    .filter((r) => r.expiresAt.getTime() > now.getTime())
    .map((r) => ({
      token: r.token,
      projectId: r.projectId,
      projectName: r.projectName,
      role: r.role,
      inviterName: r.inviterName,
      inviterEmail: r.inviterEmail,
      invitedAt: r.invitedAt.toISOString(),
      expiresAt: r.expiresAt.toISOString(),
    }))
})
