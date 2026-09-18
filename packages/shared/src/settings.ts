import { z } from "zod"

const EmailDomain = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(253)
  .regex(
    /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/,
    "Must be a valid domain (e.g. acme.com)",
  )

export const AppSettingsDTO = z.object({
  signupGated: z.boolean(),
  allowedEmailDomains: z.array(z.string()),
  updatedAt: z.string(),
})
export type AppSettingsDTO = z.infer<typeof AppSettingsDTO>

export const UpdateAppSettingsInput = z.object({
  signupGated: z.boolean().optional(),
  allowedEmailDomains: z.array(EmailDomain).max(50).optional(),
})
export type UpdateAppSettingsInput = z.infer<typeof UpdateAppSettingsInput>

/** Which OAuth sign-in providers this deployment has enabled (GET /api/auth/providers). */
export const AuthProvidersDTO = z.object({
  github: z.boolean(),
  google: z.boolean(),
})
export type AuthProvidersDTO = z.infer<typeof AuthProvidersDTO>

/** An AI assistant the user connected over MCP OAuth (GET /api/me/mcp-connections). */
export const McpConnectionDTO = z.object({
  clientId: z.string(),
  clientName: z.string(),
  scopes: z.array(z.string()),
  connectedAt: z.string().nullable(),
  lastUsedAt: z.string().nullable(),
})
export type McpConnectionDTO = z.infer<typeof McpConnectionDTO>
export const McpConnectionListDTO = z.object({ connections: z.array(McpConnectionDTO) })
export type McpConnectionListDTO = z.infer<typeof McpConnectionListDTO>
