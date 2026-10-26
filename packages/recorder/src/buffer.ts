import { EventType, type RecorderEvent } from "./types"

export interface BufferOptions {
  /** Maximum time window in ms to retain (events older than now - windowMs are dropped on push). */
  windowMs: number
  /** Maximum total serialized-byte cost; oldest events evicted when exceeded. */
  maxBytes: number
  /** Clock injection for tests. */
  now?: () => number
}

interface Entry {
  event: RecorderEvent
  bytes: number
}

/**
 * Ring buffer with two eviction triggers:
 *   1. Time: any event with timestamp < (now - windowMs) is dropped on push.
 *   2. Size: when totalBytes > maxBytes, evict oldest entries until back under.
 *
 * Byte cost is estimated via JSON.stringify length at push time — accurate
 * enough for budgeting without paying the cost twice (we re-stringify at flush).
 *
 * Supports pause/resume to freeze the rolling window. Used by the recorder
 * when the report wizard opens — without this, a 60s pause for the user to
 * annotate would shift the cutoff forward by 60s and evict all pre-pause
 * activity on the very next push after resume.
 */
export class EventBuffer {
  private entries: Entry[] = []
  private totalBytes = 0
  private pausedAt: number | null = null
  private accumulatedPauseMs = 0
  private warnedBaseline = false
  private readonly windowMs: number
  private readonly maxBytes: number
  private readonly now: () => number

  constructor(opts: BufferOptions) {
    this.windowMs = opts.windowMs
    this.maxBytes = opts.maxBytes
    this.now = opts.now ?? Date.now
  }

  push(event: RecorderEvent): void {
    const bytes = estimateBytes(event)
    this.entries.push({ event, bytes })
    this.totalBytes += bytes
    this.evictOldTimestamps()
    this.evictToFitSize()
  }

  pause(): void {
    if (this.pausedAt !== null) return
    this.pausedAt = this.now()
  }

  resume(): void {
    if (this.pausedAt === null) return
    this.accumulatedPauseMs += this.now() - this.pausedAt
    this.pausedAt = null
  }

  private evictOldTimestamps(): void {
    // Subtract paused time so the window measures *recording* age, not
    // wall-clock age. Without this, a long pause+resume would evict every
    // pre-pause event on the next push.
    const cutoff = this.now() - this.accumulatedPauseMs - this.windowMs
    while (this.entries.length > 0) {
      const first = this.entries[0]
      if (!first || first.event.timestamp >= cutoff) return
      this.totalBytes -= first.bytes
      this.entries.shift()
    }
  }

  private evictToFitSize(): void {
    // Everything before the newest FullSnapshot (and the Meta that precedes
    // it) is fair game; the pair itself is the replay's only baseline, so
    // evicting it yields a replay that cannot render at all. Prefer an
    // over-budget buffer — gzipEvents trims again at flush time — and warn
    // once so an undersized `bufferBytes` is visible to the operator.
    const protectedFrom = this.newestBaselineIndex()
    while (this.totalBytes > this.maxBytes && this.entries.length > 0) {
      if (protectedFrom !== null && protectedFrom <= 0) {
        this.warnBaselineOverBudget()
        return
      }
      const first = this.entries.shift()
      if (first) this.totalBytes -= first.bytes
      // Shifting re-indexes the array; the baseline moved one slot closer to
      // the front. Re-derive so the guard above tracks it.
      return this.evictToFitSize()
    }
  }

  private newestBaselineIndex(): number | null {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      if (this.entries[i]?.event.type === EventType.FullSnapshot) {
        const prev = this.entries[i - 1]
        return prev && prev.event.type === EventType.Meta ? i - 1 : i
      }
    }
    return null
  }

  private warnBaselineOverBudget(): void {
    if (this.warnedBaseline) return
    this.warnedBaseline = true
    console.warn(
      `[repro] replay snapshot alone exceeds the ${this.maxBytes} B buffer budget; keeping it so the replay stays playable`,
    )
  }

  flush(): RecorderEvent[] {
    const out = this.entries.map((e) => e.event)
    this.entries = []
    this.totalBytes = 0
    return out
  }

  peek(): RecorderEvent[] {
    return this.entries.map((e) => e.event)
  }

  truncateOldest(n: number): void {
    const cut = Math.min(n, this.entries.length)
    for (let i = 0; i < cut; i++) {
      const first = this.entries.shift()
      if (first) this.totalBytes -= first.bytes
    }
  }

  size(): number {
    return this.entries.length
  }

  bytes(): number {
    return this.totalBytes
  }
}

function estimateBytes(event: RecorderEvent): number {
  try {
    return JSON.stringify(event).length
  } catch {
    return 0
  }
}
