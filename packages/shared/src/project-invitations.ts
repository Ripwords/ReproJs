import { z } from "zod"
import { ProjectRole } from "./projects"

export const InvitationStatus = z.enum(["pending", "accepted", "revoked", "expired"])
export type InvitationStatus = z.infer<typeof InvitationStatus>

export const CreateProjectInvitationInput = z.object({
  email: z.email(),
  role: ProjectRole,
})
export type CreateProjectInvitationInput = z.infer<typeof CreateProjectInvitationInput>

export const ProjectInvitationDTO = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  email: z.email(),
  role: ProjectRole,
  status: InvitationStatus,
  invitedByUserId: z.string(),
  invitedByEmail: z.email().nullable(),
  createdAt: z.string(),
  expiresAt: z.string(),
})
export type ProjectInvitationDTO = z.infer<typeof ProjectInvitationDTO>

export const InvitationDetailDTO = z.object({
  token: z.string(),
  projectId: z.uuid(),
  projectName: z.string(),
  role: ProjectRole,
  email: z.email(),
  inviterName: z.string().nullable(),
  inviterEmail: z.email().nullable(),
  expiresAt: z.string(),
})
export type InvitationDetailDTO = z.infer<typeof InvitationDetailDTO>

/** One of the signed-in user's own pending invitations (GET /api/invitations). */
export const PendingInvitationDTO = z.object({
  token: z.string(),
  projectId: z.uuid(),
  projectName: z.string(),
  role: ProjectRole,
  inviterName: z.string().nullable(),
  inviterEmail: z.email().nullable(),
  invitedAt: z.string(),
  expiresAt: z.string(),
})
export type PendingInvitationDTO = z.infer<typeof PendingInvitationDTO>
