import { describe, expect, test, mock } from "bun:test"

// This test intentionally runs with no DOM (no happy-dom bootstrap),
// simulating the Node / SSR environment where a user accidentally calls
// init() during server rendering (Next.js RSC, Nuxt server route,
// SvelteKit load, etc.).
//
// @reprojs/ui and @reprojs/recorder transitively pull in Preact JSX
// modules that don't resolve cleanly when imported from a sibling
// package's test, so we mock them. The mocks also double as assertions:
// if the SSR guard is wrong, these spies will record a call and the
// test will fail.
let mountCalls = 0
let registerCalls = 0

mock.module("@reprojs/ui", () => ({
  mount: () => {
    mountCalls++
  },
  unmount: () => {},
  open: () => {},
  openMenu: () => {},
  openCapture: () => {},
  openRecord: () => {},
  openGallery: () => {},
  close: () => {},
  registerAllCollectors: () => {
    registerCalls++
    return {
      stopAll: () => {},
      snapshotAll: () => ({ logs: [], systemInfo: {}, cookies: [] }),
      applyBeforeSend: (p: unknown) => p,
      flushReplay: async () => ({ bytes: null }),
      markReplayDisabled: () => {},
      breadcrumb: () => {},
      pauseReplay: () => {},
      resumeReplay: () => {},
    }
  },
}))

describe("init — SSR safety", () => {
  test("is a no-op when window is undefined", async () => {
    expect(typeof window).toBe("undefined")
    expect(typeof document).toBe("undefined")

    const { init } = await import("./index")

    // If the guard is missing, this call throws ReferenceError in Node.
    const handle = init({
      projectKey: "rp_pk_ABCDEF1234567890abcdef12",
      endpoint: "https://dash.example.com",
    })

    expect(typeof handle.pauseReplay).toBe("function")
    expect(typeof handle.resumeReplay).toBe("function")
    expect(() => handle.pauseReplay()).not.toThrow()
    expect(() => handle.resumeReplay()).not.toThrow()

    // The guard must short-circuit BEFORE touching any downstream module
    // that would hit document/window.
    expect(mountCalls).toBe(0)
    expect(registerCalls).toBe(0)
  })

  test("public functions are safe to call server-side", async () => {
    const { identify, log, pauseReplay, resumeReplay, close } = await import("./index")

    expect(() => identify({ userId: "u_1" })).not.toThrow()
    expect(() => identify(null)).not.toThrow()
    expect(() => log("server.event", { ok: true })).not.toThrow()
    expect(() => pauseReplay()).not.toThrow()
    expect(() => resumeReplay()).not.toThrow()
    expect(() => close()).not.toThrow()
  })
})
