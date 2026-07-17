import { z } from "zod"

export const ShareMintResponse = z.object({
  id: z.string().uuid(),
  token: z.string().min(43),
  shareUrl: z.string().url(),
  expiresAt: z.string(),
})
export type ShareMintResponse = z.infer<typeof ShareMintResponse>

export const SharedMediaDTO = z.object({
  id: z.string().uuid(),
  kind: z.literal("video"),
  mime: z.string(),
  sizeBytes: z.number().int(),
  durationMs: z.number().int().nullable(),
  createdAt: z.string(),
  expiresAt: z.string(),
  revokedAt: z.string().nullable(),
  shareUrl: z.string().url(),
})
export type SharedMediaDTO = z.infer<typeof SharedMediaDTO>
