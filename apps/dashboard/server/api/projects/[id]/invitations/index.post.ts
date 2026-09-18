import { randomBytes } from "node:crypto"
import { and, eq } from "drizzle-orm"
import { createError, defineEventHandler, getRouterParam, readValidatedBody } from "h3"
import { CreateProjectInvitationInput } from "@reprojs/shared"
import { db } from "../../../../db"
import {
  appSettings,
  projectInvitations,
  projectMembers,
  projects,
  user,
} from "../../../../db/schema"
import { emailDomain, isEmailDomainOnAllowlist } from "../../../../lib/email-domain"
import { env } from "../../../../lib/env"
import { requireProjectRole } from "../../../../lib/permissions"
import { getInviteLimiter } from "../../../../lib/rate-limit"
import { sendMail } from "../../../../lib/email"
import { renderTemplate } from "../../../../lib/render-template"

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000

export default defineEventHandler(async (event) => {
  const projectId = getRouterParam(event, "id")
  if (!projectId) throw createError({ statusCode: 400, statusMessage: "missing project id" })

  const { session } = await requireProjectRole(event, projectId, "owner")
  const body = await readValidatedBody(event, (b: unknown) => CreateProjectInvitationInput.parse(b))
  const email = body.email.toLowerCase()

  const inviteLimiter = await getInviteLimiter()
  const take = await inviteLimiter.take(`invite:${session.userId}`)
  if (!take.allowed) {
    event.node.res.setHeader("Retry-After", Math.ceil(take.retryAfterMs / 1000).toString())
    throw createError({ statusCode: 429, statusMessage: "Too many invites — slow down" })
  }

  // Same rule sign-in applies, whether or not sign-up is gated — an off-list
  // invitee could accept nothing, because sign-in would refuse them.
  const [settings] = await db.select().from(appSettings).limit(1)
  if (settings && !isEmailDomainOnAllowlist(email, settings.allowedEmailDomains)) {
    throw createError({
      statusCode: 400,
      statusMessage: `Email domain "${emailDomain(email)}" is not on this install's allowlist`,
    })
  }

  let [targetUser] = await db.select().from(user).where(eq(user.email, email))
  if (targetUser) {
    const [alreadyMember] = await db
      .select()
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, targetUser.id)))
    if (alreadyMember) {
      throw createError({ statusCode: 409, statusMessage: "User is already a member" })
    }
  } else {
    // Pre-create invited user row so the magic-link sign-in path works for a
    // brand-new email; the existing after-hook flips status → active on first
    // successful sign-in.
    const [inserted] = await db
      .insert(user)
      .values({
        id: randomBytes(16).toString("hex"),
        email,
        name: email.split("@")[0] ?? email,
        emailVerified: false,
        role: "member",
        status: "invited",
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning()
    if (!inserted) {
      throw createError({ statusCode: 500, statusMessage: "Failed to create user" })
    }
    targetUser = inserted
  }

  const [existingPending] = await db
    .select()
    .from(projectInvitations)
    .where(
      and(
        eq(projectInvitations.projectId, projectId),
        eq(projectInvitations.email, email),
        eq(projectInvitations.status, "pending"),
      ),
    )
  if (existingPending) {
    throw createError({
      statusCode: 409,
      statusMessage: "An invitation is already pending for this email — resend it instead",
    })
  }

  const token = randomBytes(32).toString("hex")
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS)
  const [created] = await db
    .insert(projectInvitations)
    .values({
      projectId,
      email,
      role: body.role,
      token,
      status: "pending",
      invitedBy: session.userId,
      expiresAt,
    })
    .returning()
  if (!created) {
    throw createError({ statusCode: 500, statusMessage: "Failed to create invitation" })
  }

  const [project] = await db.select().from(projects).where(eq(projects.id, projectId))
  const [inviter] = await db.select().from(user).where(eq(user.id, session.userId))

  const acceptUrl = `${env.BETTER_AUTH_URL}/invitations/${token}`
  const html = await renderTemplate("project-invite", {
    projectName: project?.name ?? "a Repro project",
    inviterName: inviter?.name ?? session.email,
    inviterEmail: session.email,
    role: body.role,
    acceptUrl,
    expiresDays: "7",
  })
  void sendMail({
    to: email,
    subject: `You've been invited to ${project?.name ?? "Repro"}`,
    html,
  }).catch((err: unknown) => {
    console.error(`[project-invite] email delivery failed for ${email}:`, err)
  })

  event.node.res.statusCode = 201
  return {
    id: created.id,
    projectId,
    email,
    role: created.role,
    status: created.status,
    invitedByUserId: session.userId,
    invitedByEmail: session.email,
    createdAt: created.createdAt.toISOString(),
    expiresAt: created.expiresAt.toISOString(),
  }
})
