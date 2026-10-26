import { expect, test } from "@playwright/test"
import { launch } from "./harness"

// The intake endpoint is the fixture server itself: every /api/intake/*
// request is held open and never answered, which is the shape of a stalled
// upload. The page's fetch is routed MAIN world → ISOLATED bridge → service
// worker, so a result here proves the whole proxy chain, not a shim.
function hangIntake() {
  const state = { opened: 0, closed: 0 }
  const handler = (
    req: import("node:http").IncomingMessage,
    res: import("node:http").ServerResponse,
  ) => {
    if (!req.url?.startsWith("/api/intake/")) return false
    state.opened++
    res.on("close", () => {
      state.closed++
    })
    // Deliberately never ends the response.
    return true
  }
  return { state, handler }
}

test("a body above the proxy limit falls through to the page's own fetch", async () => {
  // The service-worker path stamps x-repro-origin; a direct page fetch
  // cannot. That header is the discriminator between the two routes.
  const seen: Array<{ viaProxy: boolean; length: number }> = []
  const h = await launch({
    handler: (req, res) => {
      if (!req.url?.startsWith("/api/intake/")) return false
      let length = 0
      req.on("data", (chunk: Buffer) => {
        length += chunk.length
      })
      req.on("end", () => {
        seen.push({ viaProxy: typeof req.headers["x-repro-origin"] === "string", length })
        res.setHeader("Content-Type", "application/json")
        res.end(JSON.stringify({ id: "r1" }))
      })
      return true
    },
  })
  try {
    await h.configure({ intakeEndpoint: h.testOrigin })
    const page = await h.context.newPage()
    await page.goto(h.testOrigin)
    await expect(page.locator("#repro-host")).toBeAttached({ timeout: 10_000 })

    const SMALL = 1024
    const HUGE = 31 * 1024 * 1024 // > MAX_PROXY_RAW_BODY_BYTES (~30 MB)
    const statuses = await page.evaluate(
      async ({ origin, small, huge }) => {
        const post = async (bytes: number) => {
          const res = await fetch(`${origin}/api/intake/reports`, {
            method: "POST",
            body: new Blob([new Uint8Array(bytes)]),
          })
          return res.status
        }
        return [await post(small), await post(huge)]
      },
      { origin: h.testOrigin, small: SMALL, huge: HUGE },
    )

    expect(statuses).toEqual([200, 200])
    expect(seen).toEqual([
      { viaProxy: true, length: SMALL },
      { viaProxy: false, length: HUGE },
    ])
  } finally {
    await h.close()
  }
})

test("the SDK's AbortSignal cancels the proxied service-worker fetch", async () => {
  const intake = hangIntake()
  const h = await launch({ handler: intake.handler })
  try {
    await h.configure({ intakeEndpoint: h.testOrigin })
    const page = await h.context.newPage()
    await page.goto(h.testOrigin)
    await expect(page.locator("#repro-host")).toBeAttached({ timeout: 10_000 })

    const started = Date.now()
    // Same call shape as packages/core/src/intake-client.ts, with a short
    // timeout. Before the fix the signal was dropped on the page side: this
    // promise only settled on the proxy's own 60 s timer.
    const outcome = await page.evaluate(async (origin) => {
      try {
        await fetch(`${origin}/api/intake/reports`, {
          method: "POST",
          body: "x",
          signal: AbortSignal.timeout(500),
        })
        return { settled: "resolved" as const, name: "" }
      } catch (err) {
        return { settled: "rejected" as const, name: err instanceof Error ? err.name : String(err) }
      }
    }, h.testOrigin)
    const elapsed = Date.now() - started

    expect(outcome.settled).toBe("rejected")
    expect(outcome.name).toBe("TimeoutError")
    expect(elapsed).toBeLessThan(5_000)

    // The service worker must have torn down its side too — the server
    // sees the held-open request socket close.
    expect(intake.state.opened).toBe(1)
    await expect.poll(() => intake.state.closed, { timeout: 5_000 }).toBe(1)
  } finally {
    await h.close()
  }
})
