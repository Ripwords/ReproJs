export const MAX_RECORDING_MS = 300_000
export const RECORDING_VIDEO_BPS = 2_500_000
const TICK_MS = 500
const MIME_CANDIDATES = ["video/webm;codecs=vp9", "video/webm", "video/mp4"]

export type RecordingEndReason = "stopped" | "auto" | "track-ended" | "cancelled" | "error"

export interface RecordingResult {
  blob: Blob
  mime: string
  durationMs: number
}

export interface RecordingSession {
  stop(): void
  cancel(): void
  snapshot(): RecordingResult | null
  elapsedMs(): number
}

export interface ScreenRecordDeps {
  getDisplayMedia?: (c: DisplayMediaStreamOptions) => Promise<MediaStream>
  createMediaRecorder?: (stream: MediaStream, opts: MediaRecorderOptions) => MediaRecorder
  now?: () => number
}

export interface ScreenRecordOptions extends ScreenRecordDeps {
  maxMs?: number
  onTick?: (elapsedMs: number) => void
  onEnd: (result: RecordingResult | null, reason: RecordingEndReason) => void
}

function pickMime(): string {
  const MR = globalThis.MediaRecorder as typeof MediaRecorder | undefined
  if (!MR || typeof MR.isTypeSupported !== "function") return "video/webm"
  return MIME_CANDIDATES.find((m) => MR.isTypeSupported(m)) ?? "video/webm"
}

export async function startScreenRecording(
  opts: ScreenRecordOptions,
): Promise<RecordingSession | null> {
  const now = opts.now ?? (() => performance.now())
  const maxMs = opts.maxMs ?? MAX_RECORDING_MS
  const getDM =
    opts.getDisplayMedia ??
    (navigator.mediaDevices?.getDisplayMedia
      ? navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices)
      : null)
  if (!getDM) return null

  let stream: MediaStream
  try {
    stream = await getDM({ video: true, audio: false })
  } catch {
    return null
  }

  const mime = pickMime()
  const createRecorder =
    opts.createMediaRecorder ??
    ((s: MediaStream, o: MediaRecorderOptions) => new MediaRecorder(s, o))
  let recorder: MediaRecorder
  try {
    recorder = createRecorder(stream, { mimeType: mime, videoBitsPerSecond: RECORDING_VIDEO_BPS })
  } catch {
    for (const t of stream.getTracks()) t.stop()
    return null
  }

  const chunks: Blob[] = []
  const startedAt = now()
  let finished = false
  let pendingReason: RecordingEndReason = "stopped"

  const elapsed = () => Math.max(0, Math.round(now() - startedAt))
  const assemble = (): RecordingResult | null =>
    chunks.length === 0
      ? null
      : { blob: new Blob(chunks, { type: mime }), mime, durationMs: elapsed() }

  const teardown = () => {
    clearInterval(timer)
    for (const t of stream.getTracks()) t.stop()
  }

  const finish = (reason: RecordingEndReason, result: RecordingResult | null) => {
    if (finished) return
    finished = true
    teardown()
    opts.onEnd(result, reason)
  }

  recorder.ondataavailable = (ev: BlobEvent) => {
    if (ev.data && ev.data.size > 0) chunks.push(ev.data)
  }
  recorder.onstop = () => {
    if (pendingReason === "cancelled") finish("cancelled", null)
    else finish(pendingReason, assemble())
  }
  // Kept as the on* property to match ondataavailable/onstop above; the test double
  // only implements the on* surface, not addEventListener.
  // oxlint-disable-next-line unicorn/prefer-add-event-listener
  recorder.onerror = () => {
    pendingReason = "error"
    stopRecorder()
  }

  const stopRecorder = () => {
    try {
      if (recorder.state !== "inactive") recorder.stop()
      else recorder.onstop?.(new Event("stop"))
    } catch {
      finish(
        pendingReason === "cancelled" ? "cancelled" : "error",
        pendingReason === "cancelled" ? null : assemble(),
      )
    }
  }

  const videoTrack = stream.getVideoTracks()[0]
  videoTrack?.addEventListener("ended", () => {
    pendingReason = "track-ended"
    stopRecorder()
  })

  const timer = setInterval(() => {
    const ms = elapsed()
    opts.onTick?.(ms)
    if (ms >= maxMs) {
      pendingReason = "auto"
      stopRecorder()
    }
  }, TICK_MS)

  try {
    recorder.start(1000)
  } catch {
    finish("error", null)
    return null
  }

  return {
    stop() {
      pendingReason = "stopped"
      stopRecorder()
    },
    cancel() {
      pendingReason = "cancelled"
      chunks.length = 0
      stopRecorder()
    },
    snapshot: assemble,
    elapsedMs: elapsed,
  }
}
