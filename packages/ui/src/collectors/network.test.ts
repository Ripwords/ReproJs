// packages/ui/src/collectors/network.test.ts
import { afterEach, beforeAll, describe, expect, test } from "bun:test"
import { createNetworkCollector } from "./network"

beforeAll(async () => {
  const { Window } = await import("happy-dom")
  const win = new Window()
  Object.assign(globalThis, {
    window: win,
    document: win.document,
    XMLHttpRequest: win.XMLHttpRequest,
  })
})

// Response bodies are read detached from the host's fetch promise, so give
// the background reader a moment before asserting on them.
const settle = () => new Promise((r) => setTimeout(r, 100))

describe("network collector — fetch", () => {
  const created: Array<ReturnType<typeof createNetworkCollector>> = []
  afterEach(() => {
    for (const c of created.splice(0)) c.stop()
  })

  test("records a successful fetch with status + duration", async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () =>
      new Response("ok", { status: 200, headers: { "content-type": "text/plain" } })
    const c = createNetworkCollector({})
    created.push(c)
    c.start({ maxEntries: 10 })
    await fetch("http://example.com/x")
    const entry = c.snapshot()[0]
    expect(entry?.method).toBe("GET")
    expect(entry?.url).toBe("http://example.com/x")
    expect(entry?.status).toBe(200)
    expect(entry?.initiator).toBe("fetch")
    expect(entry?.durationMs).toBeGreaterThanOrEqual(0)
    globalThis.fetch = originalFetch
  })

  test("records a failed fetch with status null + error", async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () => {
      throw new Error("offline")
    }
    const c = createNetworkCollector({})
    created.push(c)
    c.start({})
    await fetch("http://example.com/x").catch(() => {})
    const entry = c.snapshot()[0]
    expect(entry?.status).toBeNull()
    expect(entry?.error).toContain("offline")
    globalThis.fetch = originalFetch
  })

  test("redacts sensitive query params in URL", async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () => new Response("")
    const c = createNetworkCollector({})
    created.push(c)
    c.start({})
    await fetch("http://example.com/x?api_key=secret&debug=1")
    const entry = c.snapshot()[0]
    expect(entry?.url).toContain("api_key=REDACTED")
    expect(entry?.url).toContain("debug=1")
    globalThis.fetch = originalFetch
  })

  test("does not capture bodies by default", async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () => new Response("hello body")
    const c = createNetworkCollector({})
    created.push(c)
    c.start({})
    await fetch("http://example.com/x", { method: "POST", body: "hi" })
    const entry = c.snapshot()[0]
    expect(entry?.requestBody).toBeUndefined()
    expect(entry?.responseBody).toBeUndefined()
    globalThis.fetch = originalFetch
  })

  test("captures bodies when opted in", async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () => new Response("hello body")
    const c = createNetworkCollector({})
    created.push(c)
    c.start({ requestBody: true, responseBody: true, maxBodyBytes: 1024 })
    await fetch("http://example.com/x", { method: "POST", body: "hi" })
    await settle()
    const entry = c.snapshot()[0]
    expect(entry?.requestBody).toBe("hi")
    expect(entry?.responseBody).toBe("hello body")
    globalThis.fetch = originalFetch
  })

  test("stop restores the original fetch", async () => {
    const originalFetch = globalThis.fetch
    const c = createNetworkCollector({})
    c.start({})
    expect(globalThis.fetch).not.toBe(originalFetch)
    c.stop()
    expect(globalThis.fetch).toBe(originalFetch)
  })

  test("stop leaves fetch alone when another library patched it after us", async () => {
    const originalFetch = globalThis.fetch
    const c = createNetworkCollector({})
    c.start({})
    // Sentry / an APM agent wraps whatever fetch is current — ours.
    const theirs = async (input: RequestInfo | URL, init?: RequestInit) =>
      originalFetch(input, init)
    globalThis.fetch = theirs as typeof fetch
    c.stop()
    // Restoring our pre-Repro original here would have ripped their patch out.
    expect(globalThis.fetch).toBe(theirs)
    globalThis.fetch = originalFetch
  })

  test("describes FormData bodies even without opting into requestBody", async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () => new Response("")
    const c = createNetworkCollector({})
    created.push(c)
    c.start({})
    const fd = new FormData()
    fd.set("report", "{}")
    fd.set("screenshot", new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }))
    await fetch("http://example.com/x", { method: "POST", body: fd })
    const entry = c.snapshot()[0]
    expect(entry?.requestBody).toContain("FormData")
    expect(entry?.requestBody).toContain("report")
    expect(entry?.requestBody).toContain("screenshot")
    globalThis.fetch = originalFetch
  })

  test("with requestBody=true, FormData text parts are deep-inspected + scrubbed", async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () => new Response("")
    const c = createNetworkCollector({})
    created.push(c)
    c.start({ requestBody: true, maxBodyBytes: 4096 })
    const fd = new FormData()
    fd.set("title", "hello")
    fd.set("token", "Bearer abc.def.ghi")
    fd.set("screenshot", new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }))
    await fetch("http://example.com/x", { method: "POST", body: fd })
    const entry = c.snapshot()[0]
    expect(entry?.requestBody).toContain("title=hello")
    expect(entry?.requestBody).toContain("token=REDACTED")
    expect(entry?.requestBody).toContain("screenshot=<image/png 3B>")
    globalThis.fetch = originalFetch
  })

  test("describes Blob bodies with type and size", async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () => new Response("")
    const c = createNetworkCollector({})
    created.push(c)
    c.start({})
    const blob = new Blob(["hello"], { type: "text/plain" })
    await fetch("http://example.com/x", { method: "POST", body: blob })
    const entry = c.snapshot()[0]
    expect(entry?.requestBody).toContain("Blob")
    expect(entry?.requestBody).toContain("text/plain")
    expect(entry?.requestBody).toContain("5 bytes")
    globalThis.fetch = originalFetch
  })

  test("populates size from Content-Length without opting into responseBody", async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () =>
      new Response("a".repeat(250), { headers: { "content-length": "250" } })
    const c = createNetworkCollector({})
    created.push(c)
    c.start({})
    await fetch("http://example.com/x")
    const entry = c.snapshot()[0]
    expect(entry?.size).toBe(250)
    expect(entry?.responseBody).toBeUndefined()
    globalThis.fetch = originalFetch
  })

  // Streaming guard. readResponseBody runs detached, so a response that never
  // closes (SSE, long-poll) used to buffer in memory for the life of the page.

  test("skips the body of a text/event-stream response without touching the stream", async () => {
    const originalFetch = globalThis.fetch
    let pulls = 0
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        pulls += 1
        await new Promise((r) => setTimeout(r, 1))
        controller.enqueue(new TextEncoder().encode("data: tick\n\n"))
      },
    })
    globalThis.fetch = async () =>
      new Response(stream, { headers: { "content-type": "text/event-stream" } })
    const c = createNetworkCollector({})
    created.push(c)
    c.start({ responseBody: true, maxBodyBytes: 1024 })
    await fetch("http://example.com/events")
    // Bun's Response constructor primes the stream with one eager pull; the
    // collector itself must add none.
    const pullsAfterFetch = pulls
    await settle()
    const entry = c.snapshot()[0]
    expect(entry?.status).toBe(200)
    expect(entry?.responseBody).toBeUndefined()
    expect(pulls).toBe(pullsAfterFetch)
    globalThis.fetch = originalFetch
  })

  test("skips the body when Content-Length is above maxBodyBytes", async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () =>
      new Response("a".repeat(100), { headers: { "content-length": "100" } })
    const c = createNetworkCollector({})
    created.push(c)
    c.start({ responseBody: true, maxBodyBytes: 50 })
    await fetch("http://example.com/big")
    await settle()
    const entry = c.snapshot()[0]
    expect(entry?.size).toBe(100)
    expect(entry?.responseBody).toBeUndefined()
    globalThis.fetch = originalFetch
  })

  test("truncates an endless body at maxBodyBytes and cancels the reader", async () => {
    const originalFetch = globalThis.fetch
    let pulls = 0
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        pulls += 1
        await new Promise((r) => setTimeout(r, 1))
        controller.enqueue(new TextEncoder().encode("a".repeat(10)))
      },
    })
    // The collector reads a clone, i.e. one branch of a tee. Cancelling one
    // branch does not reach the underlying source's cancel() while the host
    // still holds the other branch, so observe the reader itself.
    const originalCancel = ReadableStreamDefaultReader.prototype.cancel
    let readerCancelled = false
    ReadableStreamDefaultReader.prototype.cancel = function (this: ReadableStreamDefaultReader) {
      readerCancelled = true
      return Promise.resolve()
    }
    try {
      globalThis.fetch = async () =>
        new Response(stream, { headers: { "content-type": "text/plain" } })
      const c = createNetworkCollector({})
      created.push(c)
      c.start({ responseBody: true, maxBodyBytes: 25 })
      await fetch("http://example.com/stream")
      await settle()
      const entry = c.snapshot()[0]
      expect(entry?.responseBody?.startsWith("a".repeat(25))).toBe(true)
      expect(entry?.responseBody).toContain("truncated")
      expect(entry?.responseBody?.length).toBeLessThan(60)
      expect(readerCancelled).toBe(true)
      // Reading stopped at the cap: the source is no longer being pulled.
      const pullsAtCap = pulls
      expect(pullsAtCap).toBeLessThan(10)
      await settle()
      expect(pulls).toBe(pullsAtCap)
    } finally {
      ReadableStreamDefaultReader.prototype.cancel = originalCancel
      globalThis.fetch = originalFetch
    }
  })

  test("reads headers from a Request object when init doesn't pass headers", async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () => new Response("")
    const c = createNetworkCollector({})
    created.push(c)
    c.start({ allHeaders: true })
    const req = new Request("http://example.com/x", {
      headers: { "x-trace-id": "abc", authorization: "Bearer xxx" },
    })
    await fetch(req)
    const entry = c.snapshot()[0]
    expect(entry?.requestHeaders?.["x-trace-id"]).toBe("abc")
    globalThis.fetch = originalFetch
  })
})
