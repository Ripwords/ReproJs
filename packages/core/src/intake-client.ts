import type { IntakeResponse, LogsAttachment, MediaMetaEntry, ReportContext } from "@reprojs/shared"
import type { Attachment, TrimRange } from "@reprojs/sdk-utils"
import type { ResolvedConfig } from "./config"

/** A single gallery media item selected for a report. Serialized as a
 * `media[i]` multipart part plus one aligned entry in the `mediaMeta` JSON. */
export interface IntakeMediaItem {
  blob: Blob
  mime: string
  kind: "image" | "video"
  durationMs?: number
  trim?: TrimRange
}

export interface IntakeInput {
  title: string
  description: string
  context: ReportContext
  metadata?: Record<string, string | number | boolean>
  media?: IntakeMediaItem[]
  attachments?: Attachment[]
  logs?: LogsAttachment | null
  /** Raw gzipped replay bytes (application/gzip); omitted when replay disabled or unavailable. */
  replayBytes?: Uint8Array | null
  dwellMs?: number
  honeypot?: string
}

// Maps a media mime type to the file extension used in the multipart part
// filename (`media-${i}.${ext}`). The server keys attachments off the meta
// mime, not the filename, so an unknown mime falling back to "bin" is safe.
const MEDIA_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "video/webm": "webm",
  "video/mp4": "mp4",
}

export interface IntakeResult {
  ok: true
  id: string
  replayDisabled: boolean
}

export interface IntakeError {
  ok: false
  status: number
  message: string
}

export async function postReport(
  config: ResolvedConfig,
  input: IntakeInput,
): Promise<IntakeResult | IntakeError> {
  const body = new FormData()
  body.set(
    "report",
    new Blob(
      [
        JSON.stringify({
          projectKey: config.projectKey,
          title: input.title,
          description: input.description,
          context: input.context,
          ...(input.metadata ? { metadata: input.metadata } : {}),
          ...(input.dwellMs !== undefined ? { _dwellMs: input.dwellMs } : {}),
          ...(input.honeypot !== undefined ? { _hp: input.honeypot } : {}),
        }),
      ],
      { type: "application/json" },
    ),
  )
  if (input.logs) {
    body.set(
      "logs",
      new Blob([JSON.stringify(input.logs)], { type: "application/json" }),
      "logs.json",
    )
  }
  if (input.replayBytes && input.replayBytes.length > 0) {
    // Copy into a fresh ArrayBuffer so the Blob part is typed as Uint8Array<ArrayBuffer>
    // regardless of the source buffer (ArrayBuffer | SharedArrayBuffer).
    const copy = new Uint8Array(input.replayBytes.byteLength)
    copy.set(input.replayBytes)
    body.set("replay", new Blob([copy], { type: "application/gzip" }), "replay.json.gz")
  }

  if (input.attachments && input.attachments.length > 0) {
    input.attachments.forEach((att, i) => {
      const file =
        att.blob instanceof File ? att.blob : new File([att.blob], att.filename, { type: att.mime })
      body.set(`attachment[${i}]`, file, att.filename)
    })
  }

  if (input.media && input.media.length > 0) {
    const meta: MediaMetaEntry[] = input.media.map((item, i) => {
      const ext = MEDIA_EXT[item.mime] ?? "bin"
      const file = new File([item.blob], `media-${i}.${ext}`, { type: item.mime })
      body.set(`media[${i}]`, file, file.name)
      return {
        kind: item.kind,
        mime: item.mime,
        ...(item.durationMs !== undefined ? { durationMs: item.durationMs } : {}),
        ...(item.trim ? { trim: item.trim } : {}),
      }
    })
    body.set("mediaMeta", new Blob([JSON.stringify(meta)], { type: "application/json" }))
  }

  try {
    const res = await fetch(`${config.endpoint}/api/intake/reports`, {
      method: "POST",
      body,
      credentials: "omit",
      signal: AbortSignal.timeout(30_000),
    })
    if (res.ok) {
      const data = (await res.json()) as IntakeResponse
      return { ok: true, id: data.id, replayDisabled: Boolean(data.replayDisabled) }
    }
    let message = `HTTP ${res.status}`
    try {
      const data = (await res.json()) as { statusMessage?: string; message?: string }
      message = data.statusMessage ?? data.message ?? message
    } catch {
      // non-JSON error — keep HTTP status
    }
    return { ok: false, status: res.status, message }
  } catch (err) {
    return {
      ok: false,
      status: 0,
      message: err instanceof Error ? err.message : "Network error",
    }
  }
}
