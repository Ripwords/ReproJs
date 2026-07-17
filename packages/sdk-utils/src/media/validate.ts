import { formatBytes } from "../format"
import { MEDIA_LIMITS, type MediaKind, type MediaLimits } from "./types"

export { MEDIA_LIMITS } from "./types"

export function validateMediaSelection(
  items: { kind: MediaKind; sizeBytes: number }[],
  limits: MediaLimits = MEDIA_LIMITS,
): { ok: boolean; errors: string[] } {
  const errors: string[] = []
  if (items.length > limits.maxCount) {
    errors.push(`At most ${limits.maxCount} media items per report`)
  }
  for (const item of items) {
    const cap = item.kind === "video" ? limits.videoMaxBytes : limits.imageMaxBytes
    if (item.sizeBytes > cap) {
      errors.push(`${item.kind} exceeds ${formatBytes(cap)} limit`)
    }
  }
  return { ok: errors.length === 0, errors }
}
