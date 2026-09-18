import { createError, defineEventHandler, readValidatedBody } from "h3"
import { eq } from "drizzle-orm"
import { InviteUserInput } from "@reprojs/shared"
import { randomBytes } from "node:crypto"
import { db } from "../../db"
import { appSettings, user } from "../../db/schema"
import { emailDomain, isEmailDomainOnAllowlist } from "../../lib/email-domain"
import { env } from "../../lib/env"
import { requireInstallAdmin } from "../../lib/permissions"
import { sendMail } from "../../lib/email"
import { renderTemplate } from "../../lib/render-template"
import { getInviteLimiter } from "../../lib/rate-limit"

export default defineEventHandler(async (event) => {
  const adminSession = await requireInstallAdmin(event)
  const body = await readValidatedBody(event, (b: unknown) => InviteUserInput.parse(b))

  // Cap outbound-email rate per admin so a buggy loop / stolen admin session
  // can't exhaust SMTP quota or damage sender reputation by invite-spamming.
  const inviteLimiter = await getInviteLimiter()
  const take = await inviteLimiter.take(`invite:${adminSession.userId}`)
  if (!take.allowed) {
    event.node.res.setHeader("Retry-After", Math.ceil(take.retryAfterMs / 1000).toString())
    throw createError({ statusCode: 429, statusMessage: "Too many invites — slow down" })
  }

  // Normalize email to lowercase BEFORE any lookup or insert. Every other
  // path in the repo (better-auth internals, project-invitations, auth
  // hooks) compares emails lowercased; inserting raw-case strands the
  // invitee when the signup gate is on because findUserByEmail lowercases
  // the lookup and misses the mixed-case row.
  const emailLower = body.email.toLowerCase()

  const [existing] = await db.select().from(user).where(eq(user.email, emailLower))
  if (existing) {
    throw createError({ statusCode: 409, statusMessage: "User already exists" })
  }

  // Sign-in enforces the domain allowlist whether or not sign-up is gated,
  // so an invite to an off-list domain would create a row the invitee can
  // never sign in to. Refuse it here, where the admin can see why.
  const [settings] = await db.select().from(appSettings).limit(1)
  if (settings && !isEmailDomainOnAllowlist(emailLower, settings.allowedEmailDomains)) {
    throw createError({
      statusCode: 400,
      statusMessage: `Email domain "${emailDomain(emailLower)}" is not on this install's allowlist`,
    })
  }

  // Magic-link / OAuth refactor: the invite is now purely a gate flag on the
  // user row. No token is generated — the admin's email tells the invitee to
  // go to /auth/sign-in and request a magic link (or use matching OAuth).
  // Promotion from `invited` → `active` happens in the better-auth after hook
  // on the first successful sign-in (see server/lib/auth.ts).
  const [invited] = await db
    .insert(user)
    .values({
      id: randomBytes(16).toString("hex"),
      email: emailLower,
      name: body.name ?? emailLower.split("@")[0] ?? emailLower,
      emailVerified: false,
      role: body.role,
      status: "invited",
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning()
  if (!invited) {
    throw createError({ statusCode: 500, statusMessage: "Insert failed" })
  }

  const signInUrl = `${env.BETTER_AUTH_URL}/auth/sign-in`
  const html = await renderTemplate("invite", {
    email: invited.email,
    url: signInUrl,
  })
  // Fire-and-forget: Ethereal/SMTP I/O can take 5-15s, which would otherwise
  // block the HTTP response and cause better-auth's client session heartbeat
  // to race and incorrectly drop the admin's session.
  void sendMail({ to: invited.email, subject: "You have been invited", html }).catch(
    (err: unknown) => {
      console.error(`[invite] email delivery failed for ${invited.email}:`, err)
    },
  )

  return {
    id: invited.id,
    email: invited.email,
    name: invited.name ?? null,
    role: (invited.role ?? "member") as "admin" | "member",
    status: "invited" as const,
    emailVerified: invited.emailVerified,
    createdAt: invited.createdAt.toISOString(),
  }
})
