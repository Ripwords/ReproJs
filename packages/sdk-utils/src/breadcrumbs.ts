import { RingBuffer } from "@reprojs/sdk-utils"

export type BreadcrumbLevel = "debug" | "info" | "warn" | "error"

export interface Breadcrumb {
  ts: number
  event: string
  level: BreadcrumbLevel
  data?: Record<string, string | number | boolean | null>
}

export interface BreadcrumbsConfig {
  maxEntries?: number
  maxDataBytes?: number
  enabled?: boolean
}

export interface BreadcrumbsCollector {
  start(config: BreadcrumbsConfig): void
  /** Drains the buffer. Prefer `peek()` + `clear()` so a failed upload can retry with the same logs. */
  snapshot(): Breadcrumb[]
  peek(): Breadcrumb[]
  clear(): void
  stop(): void
  breadcrumb: (
    event: string,
    data?: Record<string, string | number | boolean | null>,
    level?: BreadcrumbLevel,
  ) => void
}

export function createBreadcrumbsCollector(_initial: BreadcrumbsConfig): BreadcrumbsCollector {
  let buffer: RingBuffer<Breadcrumb> | null = null
  let running = false
  let enabled = true
  return {
    start(config) {
      enabled = config.enabled !== false
      buffer = new RingBuffer<Breadcrumb>(config.maxEntries ?? 50)
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
      running = false
      buffer = null
    },
    breadcrumb(event, data, level = "info") {
      if (!running || !enabled || !buffer) return
      buffer.push({
        ts: Date.now(),
        event: event.length > 200 ? event.slice(0, 200) : event,
        level,
        ...(data ? { data } : {}),
      })
    },
  }
}
