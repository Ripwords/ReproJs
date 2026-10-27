import { beforeAll, describe, expect, test } from "bun:test"
import { installFetchProxy } from "./proxy-fetch"

const ENDPOINT = "https://intake.test"
const PAGE_ORIGIN = "https://app.test"
// The proxy's own deadline only applies when the caller passes no signal.
// Shrink it so the "no signal" path can be exercised with real timers.
const PROXY_BASE_TIMEOUT_MS = 50

type Posted = { source?: string; type?: string; id?: string }

// Stand-in for the page's `window`: the proxy registers a message listener
// on it, posts requests through it, and the test plays the bridge by
// reading what was posted and dispatching a `response` message back.
class FakeWindow extends EventTarget {
  posted: Posted[] = []
  location = { origin: PAGE_ORIGIN, href: `${PAGE_ORIGIN}/` }
  postMessage(data: Posted): void {
    this.posted.push(data)
  }
  deliver(data: unknown): void {
    const event = new Event("message")
    Object.defineProperties(event, {
      source: { value: this },
      data: { value: data },
    })
    this.dispatchEvent(event)
  }
  // The proxy posts the request only after it has serialized the body, so
  // wait for a `request` message to appear past the given mark.
  async nextRequestId(after: number): Promise<string> {
    for (let i = 0; i < 200; i++) {
      const req = this.posted.slice(after).find((m) => m.type === "request")
      if (req?.id) return req.id
      await new Promise((r) => setTimeout(r, 1))
    }
    throw new Error("no request was posted")
  }
  abortsFor(id: string): Posted[] {
    return this.posted.filter((m) => m.type === "abort" && m.id === id)
  }
}

const win = new FakeWindow()
let proxiedFetch: typeof fetch

beforeAll(() => {
  Object.assign(globalThis, {
    window: win,
    location: win.location,
    fetch: async () => new Response("original fetch", { status: 599 }),
  })
  installFetchProxy(ENDPOINT, 1024 * 1024, PROXY_BASE_TIMEOUT_MS)
  proxiedFetch = globalThis.fetch
})

const PENDING = Symbol("pending")
async function settled<T>(p: Promise<T>, afterMs: number): Promise<T | typeof PENDING> {
  return Promise.race([
    p,
    new Promise<typeof PENDING>((r) => setTimeout(() => r(PENDING), afterMs)),
  ])
}

describe("fetch proxy deadline", () => {
  test("without a signal it times out with a TimeoutError and aborts the service-worker fetch", async () => {
    const mark = win.posted.length
    const p = proxiedFetch(`${ENDPOINT}/api/intake/reports`, { method: "POST", body: "hello" })
    const id = await win.nextRequestId(mark)
    let caught: unknown
    try {
      await p
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(DOMException)
    expect((caught as DOMException).name).toBe("TimeoutError")
    expect(win.abortsFor(id)).toHaveLength(1)
  })

  test("with a caller signal the SDK owns the deadline: no proxy timeout fires", async () => {
    const controller = new AbortController()
    const mark = win.posted.length
    const p = proxiedFetch(`${ENDPOINT}/api/intake/reports`, {
      method: "POST",
      body: "hello",
      signal: controller.signal,
    })
    const id = await win.nextRequestId(mark)
    // Well past the proxy's own base deadline and still waiting.
    expect(await settled(p, PROXY_BASE_TIMEOUT_MS * 4)).toBe(PENDING)
    expect(win.abortsFor(id)).toHaveLength(0)

    win.deliver({
      source: "repro-proxy",
      type: "response",
      id,
      ok: true,
      status: 201,
      statusText: "Created",
      bodyKind: "text",
      body: '{"id":"r1"}',
      contentType: "application/json",
    })
    const res = await p
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ id: "r1" })
  })

  test("aborting the caller signal rejects with the signal reason and aborts the service-worker fetch", async () => {
    const controller = new AbortController()
    const mark = win.posted.length
    const p = proxiedFetch(`${ENDPOINT}/api/intake/reports`, {
      method: "POST",
      body: "hello",
      signal: controller.signal,
    })
    const id = await win.nextRequestId(mark)
    controller.abort(new DOMException("The operation timed out.", "TimeoutError"))
    let caught: unknown
    try {
      await p
    } catch (err) {
      caught = err
    }
    expect((caught as DOMException).name).toBe("TimeoutError")
    expect(win.abortsFor(id)).toHaveLength(1)
  })
})
