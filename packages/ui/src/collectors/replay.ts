import { createRecorder, type MaskingMode, type Recorder } from "@reprojs/recorder"

export interface ReplayConfig {
  enabled?: boolean
  masking?: MaskingMode
  maskSelectors?: string[]
  blockSelectors?: string[]
  /** Hard cap on gzipped bytes; default 1 MB. */
  maxBytes?: number
}

export interface ReplayCollector {
  start(): void
  stop(): void
  pause(): void
  resume(): void
  /** Gzips the buffer without draining it — the buffer is cleared via `clear()` after a successful upload. */
  snapshotGzipped(): Promise<{
    bytes: Uint8Array | null
    eventCount: number
    durationMs: number
    truncated: boolean
  }>
  clear(): void
  markDisabled(): void
  isDisabled(): boolean
}

export function createReplayCollector(config: ReplayConfig): ReplayCollector {
  const enabled = config.enabled !== false
  const maxBytes = config.maxBytes ?? 1_048_576
  let recorder: Recorder | null = null
  let disabled = !enabled

  return {
    start() {
      if (disabled || recorder) return
      try {
        recorder = createRecorder({
          config: {
            masking: config.masking ?? "moderate",
            maskSelectors: config.maskSelectors,
            blockSelectors: config.blockSelectors,
          },
        })
        recorder.start()
      } catch (err) {
        console.warn("[repro] replay recorder failed to start", err)
        recorder = null
        disabled = true
      }
    },
    stop() {
      recorder?.stop()
      recorder = null
    },
    pause() {
      recorder?.pause()
    },
    resume() {
      recorder?.resume()
    },
    async snapshotGzipped() {
      if (!recorder || disabled) {
        return { bytes: null, eventCount: 0, durationMs: 0, truncated: false }
      }
      const result = await recorder.snapshotGzipped({ maxBytes })
      return {
        bytes: result.bytes,
        eventCount: result.eventCount,
        durationMs: result.durationMs,
        truncated: result.truncated,
      }
    },
    clear() {
      recorder?.clear()
    },
    markDisabled() {
      disabled = true
      recorder?.stop()
      recorder = null
    },
    isDisabled() {
      return disabled
    },
  }
}
