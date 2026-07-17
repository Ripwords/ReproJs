export type MediaKind = "image" | "video"

export interface TrimRange {
  startMs: number
  endMs: number
}

export interface MediaLimits {
  maxCount: number
  imageMaxBytes: number
  videoMaxBytes: number
}

export const MEDIA_LIMITS: MediaLimits = {
  maxCount: 3,
  imageMaxBytes: 10 * 1024 * 1024,
  videoMaxBytes: 100 * 1024 * 1024,
}
