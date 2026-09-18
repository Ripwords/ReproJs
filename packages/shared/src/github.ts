// packages/shared/src/github.ts
import { z } from "zod"

export const GithubConfigDTO = z.object({
  installed: z.boolean(),
  status: z.enum(["connected", "disconnected"]).nullable(),
  repoOwner: z.string(),
  repoName: z.string(),
  defaultLabels: z.array(z.string()),
  defaultAssignees: z.array(z.string()),
  pushOnEdit: z.boolean(),
  autoCreateOnIntake: z.boolean(),
  lastSyncedAt: z.string().nullable(),
  failedJobs: z.array(
    z.object({
      reportId: z.uuid(),
      reportTitle: z.string(),
      attempts: z.number().int(),
      lastError: z.string().nullable(),
      updatedAt: z.string(),
    }),
  ),
})
export type GithubConfigDTO = z.infer<typeof GithubConfigDTO>

export const UpdateGithubConfigInput = z.object({
  repoOwner: z.string().min(1).max(100).optional(),
  repoName: z.string().min(1).max(100).optional(),
  defaultLabels: z.array(z.string().min(1).max(50)).max(20).optional(),
  defaultAssignees: z.array(z.string().min(1).max(50)).max(20).optional(),
  pushOnEdit: z.boolean().optional(),
  autoCreateOnIntake: z.boolean().optional(),
})
export type UpdateGithubConfigInput = z.infer<typeof UpdateGithubConfigInput>

export const InstallRedirectResponse = z.object({ url: z.string().url() })
export type InstallRedirectResponse = z.infer<typeof InstallRedirectResponse>

// POST /api/projects/:id/integrations/github/labels — create a new label on
// the linked repo. Colour defaults server-side when omitted. GitHub enforces
// a 50-char name limit and allows only hex (no leading #), so we normalise
// before validating.
export const CreateGithubLabelInput = z.object({
  name: z.string().trim().min(1).max(50),
  color: z
    .string()
    .regex(/^#?[0-9a-fA-F]{6}$/, "color must be a 6-char hex")
    .optional(),
  description: z.string().max(100).optional(),
})
export type CreateGithubLabelInput = z.infer<typeof CreateGithubLabelInput>

// Response shapes for the dashboard's GitHub read endpoints. The server
// handlers annotate their return types with these, so the dashboard UI and
// the handlers share one definition.

export const GithubAppStatusDTO = z.discriminatedUnion("configured", [
  z.object({ configured: z.literal(false) }),
  z.object({
    configured: z.literal(true),
    source: z.enum(["env", "db"]),
    slug: z.string(),
    appId: z.string(),
    clientId: z.string(),
  }),
])
export type GithubAppStatusDTO = z.infer<typeof GithubAppStatusDTO>

export const GithubOAuthCredentialsDTO = z.object({
  clientId: z.string(),
  clientSecret: z.string(),
})
export type GithubOAuthCredentialsDTO = z.infer<typeof GithubOAuthCredentialsDTO>

export const GithubRepoLabelDTO = z.object({
  name: z.string(),
  color: z.string(),
  description: z.string().nullable(),
})
export type GithubRepoLabelDTO = z.infer<typeof GithubRepoLabelDTO>
export const GithubRepoLabelListDTO = z.object({ items: z.array(GithubRepoLabelDTO) })
export type GithubRepoLabelListDTO = z.infer<typeof GithubRepoLabelListDTO>

export const GithubMilestoneDTO = z.object({
  number: z.number().int(),
  title: z.string(),
  state: z.enum(["open", "closed"]),
  dueOn: z.string().nullable(),
})
export type GithubMilestoneDTO = z.infer<typeof GithubMilestoneDTO>
export const GithubMilestoneListDTO = z.object({ items: z.array(GithubMilestoneDTO) })
export type GithubMilestoneListDTO = z.infer<typeof GithubMilestoneListDTO>

export const GithubAssignableUserDTO = z.object({
  githubUserId: z.string(),
  login: z.string(),
  avatarUrl: z.string().nullable(),
  /** Set when the collaborator linked this GitHub account to a dashboard user. */
  linkedUser: z
    .object({ id: z.string(), name: z.string().nullable(), email: z.string().nullable() })
    .nullable(),
})
export type GithubAssignableUserDTO = z.infer<typeof GithubAssignableUserDTO>
export const GithubAssignableUserListDTO = z.object({ items: z.array(GithubAssignableUserDTO) })
export type GithubAssignableUserListDTO = z.infer<typeof GithubAssignableUserListDTO>

export const GithubRepositoryDTO = z.object({
  id: z.number().int(),
  owner: z.string(),
  name: z.string(),
  fullName: z.string(),
})
export type GithubRepositoryDTO = z.infer<typeof GithubRepositoryDTO>
export const GithubRepositoryPageDTO = z.object({
  repos: z.array(GithubRepositoryDTO),
  page: z.number().int(),
  perPage: z.number().int(),
  total: z.number().int(),
  hasMore: z.boolean(),
})
export type GithubRepositoryPageDTO = z.infer<typeof GithubRepositoryPageDTO>
