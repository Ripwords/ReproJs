import type { ShareMintResponse } from "@reprojs/shared"
import type { TrimRange } from "@reprojs/sdk-utils"
import type { ResolvedConfig } from "./config"

export interface ShareLinkInput {
  blob: Blob
  mime: string
  durationMs?: number
  trim?: TrimRange
}

export interface ShareLinkResult {
  ok: true
  url: string
  token: string
  expiresAt: string
}

export interface ShareLinkError {
  ok: false
  message: string
}

const MEDIA_EXT: Record<string, string> = {
  "video/webm": "webm",
  "video/mp4": "mp4",
}

// Exact strings surfaced in the gallery's inline copy-link error UX — see
// task-15-brief.md's status→message mapping.
function messageForStatus(status: number): string {
  switch (status) {
    case 404:
      return "This server does not support share links yet"
    case 403:
      return "Share links are disabled for this project"
    case 413:
      return "Recording is too large to share"
    case 429:
      return "Too many links minted — try again in a minute"
    default:
      return `Could not create link (HTTP ${status})`
  }
}

export async function mintShareLink(
  config: ResolvedConfig,
  input: ShareLinkInput,
): Promise<ShareLinkResult | ShareLinkError> {
  const body = new FormData()
  const ext = MEDIA_EXT[input.mime] ?? "bin"
  const file = new File([input.blob], `share.${ext}`, { type: input.mime })
  body.set("file", file, file.name)
  body.set(
    "meta",
    new Blob(
      [
        JSON.stringify({
          projectKey: config.projectKey,
          kind: "video",
          mime: input.mime,
          ...(input.durationMs !== undefined ? { durationMs: input.durationMs } : {}),
          ...(input.trim ? { trim: input.trim } : {}),
        }),
      ],
      { type: "application/json" },
    ),
  )

  try {
    const res = await fetch(`${config.endpoint}/api/intake/media`, {
      method: "POST",
      body,
      credentials: "omit",
      signal: AbortSignal.timeout(60_000),
    })
    if (!res.ok) {
      return { ok: false, message: messageForStatus(res.status) }
    }
    const data = (await res.json()) as ShareMintResponse
    return { ok: true, url: data.shareUrl, token: data.token, expiresAt: data.expiresAt }
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "Network error",
    }
  }
}
