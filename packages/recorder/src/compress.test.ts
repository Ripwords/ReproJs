import { describe, expect, test } from "bun:test"
import { EventType, type RecorderEvent } from "./types"
import { gzipEvents } from "./compress"

function makeEvent(i: number, size = 50): RecorderEvent {
  return {
    type: EventType.Meta,
    data: { href: "x".repeat(size), width: 800, height: 600 },
    timestamp: i,
  }
}

async function gunzip(bytes: Uint8Array): Promise<string> {
  const ds = new DecompressionStream("gzip")
  const stream = new Blob([bytes]).stream().pipeThrough(ds)
  const text = await new Response(stream).text()
  return text
}

describe("gzipEvents", () => {
  test("round-trip produces original JSON", async () => {
    const events = [makeEvent(1), makeEvent(2), makeEvent(3)]
    const result = await gzipEvents(events, { maxBytes: 1_000_000 })
    expect(result.truncated).toBe(false)
    expect(result.droppedEvents).toBe(0)
    if (!result.bytes) throw new Error("expected bytes")
    const decoded = JSON.parse(await gunzip(result.bytes)) as RecorderEvent[]
    expect(decoded).toEqual(events)
  })

  test("returns empty gzip for empty event list", async () => {
    const result = await gzipEvents([], { maxBytes: 1_000_000 })
    if (!result.bytes) throw new Error("expected bytes")
    const decoded = JSON.parse(await gunzip(result.bytes)) as RecorderEvent[]
    expect(decoded).toEqual([])
  })

  test("truncates oldest events when over maxBytes and reports droppedEvents", async () => {
    const events = Array.from({ length: 200 }, (_, i) => makeEvent(i, 200))
    const result = await gzipEvents(events, { maxBytes: 500, maxRetries: 5 })
    expect(result.truncated).toBe(true)
    expect(result.droppedEvents).toBeGreaterThan(0)
    if (!result.bytes) throw new Error("expected bytes for this size")
    expect(result.bytes.length).toBeLessThanOrEqual(500)
  })

  test("returns null bytes (no throw) when CompressionStream is unavailable", async () => {
    const original = globalThis.CompressionStream
    // Safari < 16.4 / Firefox < 113 have no CompressionStream at all.
    ;(globalThis as { CompressionStream?: unknown }).CompressionStream = undefined
    try {
      const result = await gzipEvents([makeEvent(1)], { maxBytes: 1_000_000 })
      expect(result.bytes).toBeNull()
      expect(result.eventCount).toBe(1)
    } finally {
      globalThis.CompressionStream = original
    }
  })

  test("returns null bytes when unable to fit after max retries", async () => {
    const events = Array.from({ length: 10 }, (_, i) => makeEvent(i, 10_000))
    const result = await gzipEvents(events, { maxBytes: 100, maxRetries: 3 })
    expect(result.bytes).toBeNull()
    expect(result.truncated).toBe(true)
  })
})
