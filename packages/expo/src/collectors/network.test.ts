import { test, expect, beforeEach, afterEach } from "bun:test"
import { createNetworkCollector } from "./network"

let originalFetch: typeof fetch

beforeEach(() => {
  originalFetch = globalThis.fetch
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

test("records a fetch call with method, URL, status, duration", async () => {
  const c = createNetworkCollector({
    max: 10,
    captureBodies: false,
    redact: { headerDenylist: [], bodyRedactKeys: [] },
  })

  globalThis.fetch = (async () => {
    return new Response("ok", { status: 200, headers: { "content-length": "2" } })
  }) as unknown as typeof fetch

  c.start()
  const res = await fetch("https://api.test/x", { method: "POST" })
  expect(res.status).toBe(200)

  const entries = c.snapshot()
  expect(entries).toHaveLength(1)
  expect(entries[0]?.method).toBe("POST")
  expect(entries[0]?.url).toBe("https://api.test/x")
  expect(entries[0]?.status).toBe(200)
  expect(entries[0]?.durationMs).toBeGreaterThanOrEqual(0)
  expect(entries[0]?.initiator).toBe("fetch")
  c.stop()
})

test("records fetch failures as entries with error", async () => {
  const c = createNetworkCollector({
    max: 10,
    captureBodies: false,
    redact: { headerDenylist: [], bodyRedactKeys: [] },
  })

  globalThis.fetch = (async () => {
    throw new Error("network down")
  }) as unknown as typeof fetch

  c.start()
  await expect(fetch("https://api.test/fail")).rejects.toThrow("network down")

  const entries = c.snapshot()
  expect(entries[0]?.error).toContain("network down")
  expect(entries[0]?.status).toBeNull()
  c.stop()
})

test("redacts denylisted request headers", async () => {
  const c = createNetworkCollector({
    max: 10,
    captureBodies: false,
    redact: { headerDenylist: ["authorization"], bodyRedactKeys: [] },
  })

  globalThis.fetch = (async () => new Response("ok", { status: 200 })) as unknown as typeof fetch

  c.start()
  await fetch("https://api.test/x", { headers: { Authorization: "secret", "X-Ok": "public" } })

  const entry = c.snapshot()[0]
  expect(entry?.requestHeaders?.authorization).toBe("[redacted]")
  expect(entry?.requestHeaders?.["x-ok"]).toBe("public")
  c.stop()
})

// Sentry, Datadog, polyfills: anything that wraps fetch after Repro started
// would be ripped out by stop() restoring the pre-Repro fetch wholesale, with
// Repro's own wrapper still inside the other library's chain.
test("stop leaves a wrapper that another library installed after start in place", () => {
  const c = createNetworkCollector({
    max: 10,
    captureBodies: false,
    redact: { headerDenylist: [], bodyRedactKeys: [] },
  })
  c.start()
  const reproWrapper = globalThis.fetch
  const otherLibrary = ((...args: Parameters<typeof fetch>) =>
    reproWrapper(...args)) as typeof fetch
  globalThis.fetch = otherLibrary
  c.stop()
  expect(globalThis.fetch).toBe(otherLibrary)
})

test("stop restores the original fetch", () => {
  const original = globalThis.fetch
  const c = createNetworkCollector({
    max: 10,
    captureBodies: false,
    redact: { headerDenylist: [], bodyRedactKeys: [] },
  })
  c.start()
  expect(globalThis.fetch).not.toBe(original)
  c.stop()
  expect(globalThis.fetch).toBe(original)
})
