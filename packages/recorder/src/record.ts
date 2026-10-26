import { EventBuffer } from "./buffer"
import { gzipEvents, type GzipResult } from "./compress"
import { createMask, type MaskConfig } from "./mask"
import { Mirror } from "./mirror"
import {
  createInputObserver,
  createMouseInteractionObserver,
  createMouseMoveObserver,
  createMutationObserver,
  createScrollObserver,
  createStyleSheetRuleObserver,
  createViewportObserver,
  emitFullSnapshot,
} from "./observers"
import { EventType, type RecorderEvent } from "./types"

const now = (): number => Date.now()

export interface RecorderConfig extends MaskConfig {
  /** Recorder window in ms; events older than this get evicted on push. Default 30s. */
  windowMs?: number
  /**
   * Re-take a FullSnapshot every N ms so the rolling buffer never evicts its
   * only baseline. Must be strictly less than `windowMs`, otherwise the
   * baseline can expire before a replacement is taken.
   *
   * The re-snapshot is deferred to `requestIdleCallback` so it can't jank the
   * host app. Default: `windowMs / 2`. Set to 0 to disable re-snapshotting
   * (recorder will only ever emit the initial snapshot; replay breaks after
   * `windowMs` of activity).
   */
  checkoutEveryMs?: number
  /**
   * Throttle for sampling mouse/touch/drag positions. Default 50 ms (20 Hz).
   * Matches rrweb's default; lower values are smoother but cost more buffer
   * bytes.
   */
  mouseMoveSampleMs?: number
  /**
   * How often batched mouse positions are emitted as a single MouseMove
   * event. Default 500 ms. Matches rrweb's default.
   */
  mouseMoveFlushMs?: number
}

export interface RecorderOptions {
  doc?: Document
  config: RecorderConfig
  bufferBytes?: number
}

export interface Recorder {
  start(): void
  stop(): void
  pause(): void
  resume(): void
  peek(): RecorderEvent[]
  /** Gzips the current buffer AND empties it. Prefer `snapshotGzipped()` + `clear()`. */
  flushGzipped(opts: { maxBytes: number }): Promise<GzipResult>
  /** Gzips the current buffer without emptying it, so a failed upload can retry. */
  snapshotGzipped(opts: { maxBytes: number }): Promise<GzipResult>
  /** Empties the buffer — call once the upload that consumed the snapshot succeeded. */
  clear(): void
}

export function createRecorder(opts: RecorderOptions): Recorder {
  const doc = opts.doc ?? document
  const win = doc.defaultView ?? (globalThis as unknown as Window)
  const mirror = new Mirror()
  const mask = createMask(opts.config)
  const windowMs = opts.config.windowMs ?? 30_000
  const buffer = new EventBuffer({
    windowMs,
    maxBytes: opts.bufferBytes ?? 4_000_000,
  })
  const checkoutEveryMs = opts.config.checkoutEveryMs ?? Math.floor(windowMs / 2)
  let paused = false
  let stopped = false
  let handles: Array<{ start(): void; stop(): void }> = []
  let checkoutTimer: ReturnType<typeof setInterval> | null = null

  function push(ev: RecorderEvent): void {
    if (paused || stopped) return
    buffer.push(ev)
  }

  function emitIncremental(ev: RecorderEvent): void {
    push(ev)
  }

  function takeCheckoutSnapshot(): void {
    if (paused || stopped) return
    try {
      const [meta, full] = emitFullSnapshot({ doc, mirror, mask, now })
      buffer.push(meta)
      buffer.push(full)
    } catch (err) {
      console.warn("[repro] checkout snapshot failed", err)
    }
  }

  function scheduleCheckout(): void {
    if (paused || stopped) return
    // Defer the DOM walk to browser idle time so re-snapshotting doesn't
    // compete with user interactions. requestIdleCallback runs when the
    // main thread would otherwise be idle and hands us a deadline; for a
    // bug-report recorder we don't need sub-frame precision, so we pass a
    // generous 1s timeout as a safety net. Safari <17 lacks rIC — fall
    // back to a 0-delay setTimeout so we at least defer past the current
    // task and don't block a fresh frame.
    const g = globalThis as unknown as {
      requestIdleCallback?: (
        cb: (deadline: { didTimeout: boolean }) => void,
        opts?: { timeout: number },
      ) => number
    }
    if (typeof g.requestIdleCallback === "function") {
      g.requestIdleCallback(() => takeCheckoutSnapshot(), { timeout: 1_000 })
    } else {
      setTimeout(takeCheckoutSnapshot, 0)
    }
  }

  function start(): void {
    if (stopped) throw new Error("recorder: already stopped")
    try {
      const [meta, full] = emitFullSnapshot({ doc, mirror, mask, now })
      buffer.push(meta)
      buffer.push(full)
    } catch (err) {
      console.warn("[repro] full-snapshot failed; recorder disabled", err)
      stopped = true
      return
    }
    handles = [
      createMutationObserver({ doc, mirror, mask, emit: emitIncremental, now }),
      createInputObserver({ doc, mirror, mask, emit: emitIncremental, now }),
      createMouseInteractionObserver({ doc, mirror, emit: emitIncremental, now }),
      createMouseMoveObserver({
        doc,
        mirror,
        emit: emitIncremental,
        now,
        sampleMs: opts.config.mouseMoveSampleMs,
        flushMs: opts.config.mouseMoveFlushMs,
      }),
      createScrollObserver({ doc, mirror, emit: emitIncremental, now }),
      createStyleSheetRuleObserver({ doc, mirror, emit: emitIncremental, now }),
      createViewportObserver({ win: win as Window, emit: emitIncremental, now }),
    ]
    for (const h of handles) {
      try {
        h.start()
      } catch (err) {
        console.warn("[repro] observer failed to start", err)
      }
    }
    if (checkoutEveryMs > 0) {
      // The interval itself is cheap — it only schedules. The actual DOM
      // walk happens in scheduleCheckout → requestIdleCallback so we never
      // block the host app's interaction frames.
      checkoutTimer = setInterval(scheduleCheckout, checkoutEveryMs)
    }
  }

  function stop(): void {
    stopped = true
    if (checkoutTimer !== null) {
      clearInterval(checkoutTimer)
      checkoutTimer = null
    }
    for (const h of handles) {
      try {
        h.stop()
      } catch {
        // best-effort teardown
      }
    }
    handles = []
  }

  function pause(): void {
    if (paused || stopped) return
    paused = true
    // Push the marker first (still receives eviction at current wall-clock
    // time), then freeze the buffer's window so the upcoming pause duration
    // doesn't shift the cutoff and silently nuke pre-pause events on resume.
    buffer.push({ type: EventType.Custom, data: { tag: "paused", payload: {} }, timestamp: now() })
    buffer.pause()
  }

  function resume(): void {
    if (!paused || stopped) return
    paused = false
    // Unfreeze the window first (records the elapsed pause duration), then
    // push the resumed marker so it lands inside the now-corrected window.
    buffer.resume()
    buffer.push({ type: EventType.Custom, data: { tag: "resumed", payload: {} }, timestamp: now() })
  }

  return {
    start,
    stop,
    pause,
    resume,
    peek: () => buffer.peek(),
    async flushGzipped({ maxBytes }) {
      const events = buffer.flush()
      return gzipEvents(events, { maxBytes })
    },
    async snapshotGzipped({ maxBytes }) {
      return gzipEvents(buffer.peek(), { maxBytes })
    },
    clear: () => {
      buffer.flush()
    },
  }
}
