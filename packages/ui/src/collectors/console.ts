import { RingBuffer } from "@reprojs/sdk-utils"
import { serializeArg } from "./serialize"

export type ConsoleLevel = "log" | "info" | "warn" | "error" | "debug"

export interface ConsoleEntry {
  level: ConsoleLevel
  ts: number
  args: string[]
  stack?: string
}

export interface ConsoleConfig {
  maxEntries?: number
  maxArgBytes?: number
  maxEntryBytes?: number
  enabled?: boolean
  stringRedactors?: RegExp[]
}

export interface ConsoleCollector {
  start(config: ConsoleConfig): void
  /** Drains the buffer. Prefer `peek()` + `clear()` so a failed upload can retry with the same logs. */
  snapshot(): ConsoleEntry[]
  peek(): ConsoleEntry[]
  clear(): void
  stop(): void
}

const METHODS: ConsoleLevel[] = ["log", "info", "warn", "error", "debug"]

export function createConsoleCollector(_initial: ConsoleConfig): ConsoleCollector {
  let buffer: RingBuffer<ConsoleEntry> | null = null
  const originals: Partial<Record<ConsoleLevel, (...args: unknown[]) => void>> = {}
  let errorListener: ((e: ErrorEvent) => void) | null = null
  let rejectionListener: ((e: PromiseRejectionEvent) => void) | null = null
  let running = false
  return {
    start(config) {
      if (running) return
      if (config.enabled === false) return
      const maxArg = config.maxArgBytes ?? 1024
      const redactors = config.stringRedactors ?? []
      buffer = new RingBuffer<ConsoleEntry>(config.maxEntries ?? 100)
      for (const level of METHODS) {
        // Store the original unbound reference to restore it exactly
        originals[level] = console[level]
        const orig = console[level].bind(console)
        console[level] = (...args: unknown[]) => {
          try {
            const serialized = args.map((a) => serializeArg(a, maxArg, redactors))
            const entry: ConsoleEntry = {
              level,
              ts: Date.now(),
              args: serialized,
            }
            if (level === "warn" || level === "error") {
              entry.stack = new Error("trace").stack ?? undefined
            }
            buffer?.push(entry)
          } catch {
            // Never let collector throw into host code
          }
          orig(...args)
        }
      }

      // Uncaught exceptions and unhandled promise rejections don't flow through
      // console.error — the browser reports them to DevTools via the `error`
      // and `unhandledrejection` window events. Users see them as red errors
      // in DevTools and expect them in the report, so capture them explicitly
      // and push as level="error" entries.
      if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
        errorListener = (e: ErrorEvent) => {
          try {
            const msg = e.message || "Uncaught error"
            const where = e.filename ? `${e.filename}:${e.lineno ?? 0}:${e.colno ?? 0}` : ""
            const detail = e.error instanceof Error ? serializeArg(e.error, maxArg, redactors) : ""
            const args = [serializeArg(msg, maxArg, redactors)]
            if (where) args.push(serializeArg(where, maxArg, redactors))
            if (detail) args.push(detail)
            buffer?.push({
              level: "error",
              ts: Date.now(),
              args,
              stack:
                (e.error instanceof Error ? e.error.stack : undefined) ?? new Error("trace").stack,
            })
          } catch {
            // Never let collector throw into host code
          }
        }
        rejectionListener = (e: PromiseRejectionEvent) => {
          try {
            const reason = e.reason
            const args = [
              serializeArg("Unhandled promise rejection", maxArg, redactors),
              serializeArg(reason, maxArg, redactors),
            ]
            buffer?.push({
              level: "error",
              ts: Date.now(),
              args,
              stack: reason instanceof Error ? reason.stack : new Error("trace").stack,
            })
          } catch {
            // Never let collector throw into host code
          }
        }
        window.addEventListener("error", errorListener)
        window.addEventListener("unhandledrejection", rejectionListener)
      }

      running = true
    },
    snapshot() {
      return buffer?.drain() ?? []
    },
    peek() {
      return buffer?.peek() ?? []
    },
    clear() {
      buffer?.clear()
    },
    stop() {
      if (!running) return
      for (const level of METHODS) {
        const o = originals[level]
        if (o) console[level] = o
      }
      for (const key of Object.keys(originals) as ConsoleLevel[]) delete originals[key]
      if (typeof window !== "undefined" && typeof window.removeEventListener === "function") {
        if (errorListener) window.removeEventListener("error", errorListener)
        if (rejectionListener) window.removeEventListener("unhandledrejection", rejectionListener)
      }
      errorListener = null
      rejectionListener = null
      buffer = null
      running = false
    },
  }
}
