// packages/ui/src/collectors/index.test.ts
import { afterEach, beforeAll, describe, expect, test } from "bun:test"
import { registerAllCollectors, type PendingReport } from "./index"

beforeAll(async () => {
  const { Window } = await import("happy-dom")
  const win = new Window({ url: "http://localhost/" })
  Object.assign(globalThis, {
    window: win,
    document: win.document,
    location: win.location,
    navigator: win.navigator,
    screen: win.screen,
  })
})

describe("registerAllCollectors", () => {
  const stops: Array<() => void> = []
  afterEach(() => {
    for (const s of stops.splice(0)) s()
  })

  test("snapshotAll returns systemInfo + cookies + logs shape", () => {
    const { snapshotAll, stopAll } = registerAllCollectors({})
    stops.push(stopAll)
    const snap = snapshotAll()
    expect(snap.systemInfo).toBeDefined()
    expect(Array.isArray(snap.cookies)).toBe(true)
    expect(snap.logs.version).toBe(1)
    expect(Array.isArray(snap.logs.console)).toBe(true)
    expect(Array.isArray(snap.logs.network)).toBe(true)
    expect(Array.isArray(snap.logs.breadcrumbs)).toBe(true)
    expect(snap.logs.config.capturesBodies).toBe(false)
    expect(snap.logs.config.capturesAllHeaders).toBe(false)
  })

  test("breadcrumb exposed and routed", () => {
    const { snapshotAll, stopAll, breadcrumb } = registerAllCollectors({})
    stops.push(stopAll)
    breadcrumb("checkout.done", { amount: 42 })
    expect(snapshotAll().logs.breadcrumbs[0]?.event).toBe("checkout.done")
  })

  test("snapshotAll does not drain — a retry after a failed upload still has the logs", () => {
    const { snapshotAll, stopAll, breadcrumb } = registerAllCollectors({})
    stops.push(stopAll)
    breadcrumb("first.attempt")
    const first = snapshotAll()
    expect(first.logs.breadcrumbs.map((b) => b.event)).toEqual(["first.attempt"])
    // Simulates "Send report" again after a 5xx/timeout: the second snapshot
    // must still carry everything the first one did.
    const second = snapshotAll()
    expect(second.logs.breadcrumbs.map((b) => b.event)).toEqual(["first.attempt"])
  })

  test("clearBuffers empties the log buffers once the upload has succeeded", () => {
    const { snapshotAll, stopAll, breadcrumb, clearBuffers } = registerAllCollectors({})
    stops.push(stopAll)
    breadcrumb("sent")
    expect(snapshotAll().logs.breadcrumbs.length).toBe(1)
    clearBuffers()
    expect(snapshotAll().logs.breadcrumbs.length).toBe(0)
  })

  test("applyBeforeSend returns original when hook returns undefined (bypass)", () => {
    const { applyBeforeSend, stopAll } = registerAllCollectors({})
    stops.push(stopAll)
    const r: PendingReport = {
      title: "t",
      description: "",
      context: { pageUrl: "http://x", userAgent: "", viewport: { w: 1, h: 1 }, timestamp: "" },
      logs: null,
      screenshot: null,
    }
    expect(applyBeforeSend(r)).toBe(r)
  })

  test("applyBeforeSend returns hook result", () => {
    const { applyBeforeSend, stopAll } = registerAllCollectors({
      beforeSend: (r) => ({ ...r, title: "changed" }),
    })
    stops.push(stopAll)
    const r: PendingReport = {
      title: "t",
      description: "",
      context: { pageUrl: "http://x", userAgent: "", viewport: { w: 1, h: 1 }, timestamp: "" },
      logs: null,
      screenshot: null,
    }
    expect(applyBeforeSend(r)?.title).toBe("changed")
  })

  test("applyBeforeSend fails open when hook throws", () => {
    const { applyBeforeSend, stopAll } = registerAllCollectors({
      beforeSend: () => {
        throw new Error("oops")
      },
    })
    stops.push(stopAll)
    const r: PendingReport = {
      title: "kept",
      description: "",
      context: { pageUrl: "http://x", userAgent: "", viewport: { w: 1, h: 1 }, timestamp: "" },
      logs: null,
      screenshot: null,
    }
    const result = applyBeforeSend(r)
    expect(result?.title).toBe("kept")
  })

  test("applyBeforeSend null return aborts", () => {
    const { applyBeforeSend, stopAll } = registerAllCollectors({ beforeSend: () => null })
    stops.push(stopAll)
    const r: PendingReport = {
      title: "t",
      description: "",
      context: { pageUrl: "http://x", userAgent: "", viewport: { w: 1, h: 1 }, timestamp: "" },
      logs: null,
      screenshot: null,
    }
    expect(applyBeforeSend(r)).toBeNull()
  })
})
