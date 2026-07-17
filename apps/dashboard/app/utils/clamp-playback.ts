export interface PlaybackClampInput {
  currentTime: number
  duration: number
  trimStartMs: number | null
  trimEndMs: number | null
}

export type PlaybackClampAction =
  | { type: "none" }
  | { type: "seek"; to: number }
  | { type: "pause-and-reset"; to: number }

// Below this gap (seconds), a seek is not worth issuing. This is what
// breaks the reassignment loop: when trimStartMs exceeds the video's real
// duration, the browser clamps a seek to `duration` and fires `timeupdate`
// again with currentTime already sitting (almost) exactly at the clamped
// startS — without this epsilon the handler would keep reassigning
// currentTime forever.
const SEEK_EPSILON_S = 0.25

export function clampPlayback(input: PlaybackClampInput): PlaybackClampAction {
  const { currentTime, duration, trimStartMs, trimEndMs } = input

  let startS = (trimStartMs ?? 0) / 1000
  let endS = trimEndMs != null ? trimEndMs / 1000 : Number.POSITIVE_INFINITY

  // duration is NaN/Infinity while metadata is still loading — don't let a
  // not-yet-known duration cap the trim window.
  const hasKnownDuration = Number.isFinite(duration)
  if (hasKnownDuration) {
    startS = Math.min(startS, duration)
    endS = Math.min(endS, duration)
  }

  // Degenerate row (e.g. trimStartMs far beyond the real duration, both
  // capped down to the same value): play untrimmed rather than fighting
  // the metadata.
  if (startS >= endS) {
    return { type: "none" }
  }

  if (currentTime < startS && startS - currentTime > SEEK_EPSILON_S) {
    return { type: "seek", to: startS }
  }

  // Only pause-and-reset for a *real* trim end (strictly before the actual
  // duration). Natural end-of-video with no/degenerate trim end must fall
  // through to "none" — otherwise every video would pause-and-reset on
  // reaching EOF.
  if (currentTime >= endS && hasKnownDuration && endS < duration) {
    return { type: "pause-and-reset", to: startS }
  }

  return { type: "none" }
}
