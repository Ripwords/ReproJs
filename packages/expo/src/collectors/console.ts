import {
  RingBuffer,
  safeStringify,
  scrubString,
  DEFAULT_STRING_REDACTORS,
} from "@reprojs/sdk-utils"

export interface ConsoleEntry {
  level: "log" | "info" | "warn" | "error" | "debug"
  ts: number
  args: string[]
  stack?: string
}

const LEVELS = ["log", "info", "warn", "error", "debug"] as const
const SENTINEL = "__reprojs_patched"

// Cap each argument by characters, not bytes: `truncate` from sdk-utils uses
// TextEncoder, which Hermes does not provide.
const MAX_ARG_CHARS = 1024

function stringifyArg(v: unknown): string {
  // safeStringify is total by contract — it never returns a non-string.
  // The previous implementation here returned the JS value `undefined` for
  // undefined / function / symbol args, which JSON.stringify turned into
  // `null` on the wire. The intake API validates console[].args as
  // z.array(z.string()), answered 400 "Invalid logs payload", and the queue
  // flusher then discarded the report as a non-retryable client error — so
  // the wizard showed success and the report never arrived.
  const raw = safeStringify(v)
  const capped = raw.length > MAX_ARG_CHARS ? `${raw.slice(0, MAX_ARG_CHARS)}…` : raw
  return scrubString(capped, DEFAULT_STRING_REDACTORS)
}

export interface ConsoleCollector {
  start: () => void
  stop: () => void
  snapshot: () => ConsoleEntry[]
  clear: () => void
}

export function createConsoleCollector(opts: { max: number }): ConsoleCollector {
  const buf = new RingBuffer<ConsoleEntry>(opts.max)
  const originals: Partial<Record<(typeof LEVELS)[number], (...args: unknown[]) => void>> = {}
  const installed: Partial<Record<(typeof LEVELS)[number], (...args: unknown[]) => void>> = {}
  let started = false

  function start() {
    if (started) return
    started = true
    for (const level of LEVELS) {
      const existing = console[level] as ((...args: unknown[]) => void) & {
        [SENTINEL]?: boolean
      }
      if (existing?.[SENTINEL]) continue
      originals[level] = existing
      const wrapped = ((...args: unknown[]) => {
        // Record only while this wrapper is the one we installed; it may
        // outlive stop() inside another logger's chain.
        if (installed[level] !== wrapped) {
          existing.apply(console, args)
          return
        }
        try {
          buf.push({
            level,
            ts: Date.now(),
            args: args.map(stringifyArg),
            stack:
              level === "warn" || level === "error"
                ? new Error().stack?.split("\n").slice(2).join("\n")
                : undefined,
          })
        } catch {
          // fail-open
        }
        existing.apply(console, args)
      }) as ((...args: unknown[]) => void) & { [SENTINEL]?: boolean }
      wrapped[SENTINEL] = true
      installed[level] = wrapped
      console[level] = wrapped as (typeof console)[typeof level]
    }
  }

  function stop() {
    if (!started) return
    started = false
    for (const level of LEVELS) {
      const original = originals[level]
      // Only unwind a level that still holds our wrapper. If a logger wrapped
      // console.* after us, restoring the pre-Repro function would rip its
      // wrapper out; ours keeps calling through, so leaving it is harmless.
      if (original && console[level] === installed[level]) {
        console[level] = original as (typeof console)[typeof level]
      }
      delete originals[level]
      delete installed[level]
    }
  }

  return {
    start,
    stop,
    snapshot: () => buf.peek(),
    clear: () => buf.clear(),
    // Test-only access to the underlying buffer for fail-open test:
    __buf: buf,
  } as ConsoleCollector & { __buf: RingBuffer<ConsoleEntry> }
}
