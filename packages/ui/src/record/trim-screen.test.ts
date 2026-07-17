import { afterEach, describe, expect, test } from "bun:test"
import { render } from "preact"
import { Window } from "happy-dom"
import { h } from "preact"
import { clampTrim, TrimScreen } from "./trim-screen"

// Snapshot the real globals so each test's happy-dom Window doesn't bleed
// into unrelated test files that run later in the same bun:test process
// (bun:test shares one globalThis across all files unless restored).
const realDocument = globalThis.document
const realWindow = globalThis.window
// TrimScreen's mount/cleanup effect calls the *global* URL.createObjectURL /
// revokeObjectURL (not window.URL) — happy-dom's Window swap above never
// touches it, so stubbing/restoring it is independent of setupDom/afterEach.
const realCreateObjectURL = URL.createObjectURL
const realRevokeObjectURL = URL.revokeObjectURL

function setupDom() {
  const win = new Window()
  // @ts-expect-error
  globalThis.document = win.document
  // @ts-expect-error
  globalThis.window = win
  return win
}

afterEach(() => {
  // @ts-expect-error
  globalThis.document = realDocument
  // @ts-expect-error
  globalThis.window = realWindow
  URL.createObjectURL = realCreateObjectURL
  URL.revokeObjectURL = realRevokeObjectURL
})

// A single `setTimeout(r, 0)` tick (the pattern used elsewhere in this file)
// is enough to flush a regular state update — Preact's core render queue is
// microtask-based (`Promise.resolve().then(process)`), which always drains
// before a macrotask callback runs. It is NOT enough to flush a passive
// `useEffect` mount/cleanup callback: this bun+happy-dom environment has no
// global `requestAnimationFrame`, so `preact/hooks` falls back to
// `setTimeout(callback, 35)` (see `RAF_TIMEOUT` in
// node_modules/preact/hooks/src/index.js) before even scheduling the actual
// effect run. Poll instead of guessing a fixed delay, so this stays correct
// (and fast on a quick machine) regardless of exact scheduler timing.
async function waitFor(predicate: () => boolean, timeoutMs = 500): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) return // let the caller's own `expect` fail with a clear diff
    await new Promise((r) => setTimeout(r, 5))
  }
}

// Walk DOM tree collecting every element matching the class, since
// querySelector/querySelectorAll throw in this happy-dom + bun setup (see
// step-review.test.ts's walkForClass, which sidesteps the same bug).
function walkAllByClass(node: Element, cls: string): Element[] {
  const out: Element[] = []
  const classes = node.className?.split?.(" ") ?? []
  if (classes.includes(cls)) out.push(node)
  for (let i = 0; i < node.childNodes.length; i++) {
    const child = node.childNodes[i]
    if (child && (child as Element).tagName) out.push(...walkAllByClass(child as Element, cls))
  }
  return out
}

test("clampTrim clamps to duration and snaps to 100ms", () => {
  expect(clampTrim({ startMs: 149, endMs: 8_051 }, 10_000)).toEqual({ startMs: 100, endMs: 8_100 })
  // Both edges land outside [0, durationMs]; clamping pulls them to the
  // extremes, which snap onto the full-clip range — see the "full-length
  // range" test below for why that collapses to undefined.
  expect(clampTrim({ startMs: -50, endMs: 99_999 }, 10_000)).toBeUndefined()
})

test("clampTrim returns undefined for a full-length range", () => {
  expect(clampTrim({ startMs: 0, endMs: 10_000 }, 10_000)).toBeUndefined()
  expect(clampTrim({ startMs: 49, endMs: 10_000 }, 10_000)).toBeUndefined() // snaps to 0..duration
})

test("clampTrim keeps at least 100ms of clip", () => {
  expect(clampTrim({ startMs: 5_000, endMs: 5_020 }, 10_000)).toEqual({
    startMs: 5_000,
    endMs: 5_100,
  })
})

describe("TrimScreen", () => {
  test("renders Confirm/Cancel and fires callbacks exactly once", async () => {
    const win = setupDom()
    const root = win.document.createElement("div")
    win.document.body.appendChild(root as unknown as Node)

    let confirmCount = 0
    let confirmedTrim: unknown
    let cancelCount = 0

    render(
      h(TrimScreen, {
        blob: new Blob(["fake"], { type: "video/webm" }),
        durationMs: 10_000,
        onConfirm: (trim) => {
          confirmCount++
          confirmedTrim = trim
        },
        onCancel: () => {
          cancelCount++
        },
      }),
      root as unknown as Element,
    )

    // TrimScreen's mount effect (URL.createObjectURL) is a Preact passive
    // effect, deferred to a microtask after the synchronous render. Let it
    // flush here, before the DOM assertions and — more importantly — before
    // this test's afterEach swaps `globalThis.window`/`document` back. An
    // effect that fires later, against a document that's already been
    // replaced by a subsequent test file, is exactly what produced the
    // "Unhandled error between tests" flakes in unrelated files (e.g.
    // theme-css.test.ts) during manual repeated-run soak testing.
    await new Promise((r) => setTimeout(r, 0))

    const confirmBtn = walkAllByClass(root as unknown as Element, "ft-btn-primary")[0] as
      | HTMLElement
      | undefined
    const cancelBtn = walkAllByClass(root as unknown as Element, "ft-btn-secondary")[0] as
      | HTMLElement
      | undefined
    expect(confirmBtn).toBeTruthy()
    expect(cancelBtn).toBeTruthy()

    confirmBtn?.click()
    confirmBtn?.click()
    cancelBtn?.click()

    expect(confirmCount).toBe(2)
    expect(confirmedTrim).toBeUndefined()
    expect(cancelCount).toBe(1)

    // Unmount so the component's cleanup effect (revokeObjectURL) runs, then
    // let that effect flush too before the test ends.
    render(null, root as unknown as Element)
    await new Promise((r) => setTimeout(r, 0))
  })

  test("falls back to a message when the video errors (CSP-blocked preview), sliders stay usable", async () => {
    const win = setupDom()
    const root = win.document.createElement("div")
    win.document.body.appendChild(root as unknown as Node)

    let confirmCount = 0
    let confirmedTrim: unknown

    render(
      h(TrimScreen, {
        blob: new Blob(["fake"], { type: "video/webm" }),
        durationMs: 10_000,
        onConfirm: (trim) => {
          confirmCount++
          confirmedTrim = trim
        },
        onCancel: () => {},
      }),
      root as unknown as Element,
    )

    await new Promise((r) => setTimeout(r, 0))

    const video = walkAllByClass(root as unknown as Element, "ft-trim-video")[0] as
      | HTMLElement
      | undefined
    expect(video).toBeTruthy()

    // Simulate a CSP `media-src`/`blob:` refusal: the <video> fires `error`,
    // never `loadeddata`.
    video?.dispatchEvent(new win.Event("error", { bubbles: true }))

    await new Promise((r) => setTimeout(r, 0))

    const fallback = walkAllByClass(root as unknown as Element, "ft-trim-fallback")[0]
    expect(fallback).toBeTruthy()
    expect(fallback?.textContent).toBe("Preview unavailable on this site — the recording is intact")
    // The <video> itself is gone once the fallback renders (mutually
    // exclusive branches in TrimScreen's render).
    expect(walkAllByClass(root as unknown as Element, "ft-trim-video").length).toBe(0)

    const sliders = walkAllByClass(
      root as unknown as Element,
      "ft-trim-slider",
    ) as HTMLInputElement[]
    expect(sliders.length).toBe(2)

    const startSlider = sliders[0] as HTMLInputElement
    startSlider.value = "2000"
    startSlider.dispatchEvent(new win.Event("input", { bubbles: true }))

    // Flush the resulting setStartMs before reading the Confirm button:
    // without this tick, Confirm's onClick closure still captures the
    // pre-update state from the last completed render.
    await new Promise((r) => setTimeout(r, 0))

    const confirmBtn = walkAllByClass(root as unknown as Element, "ft-btn-primary")[0] as
      | HTMLElement
      | undefined
    confirmBtn?.click()

    expect(confirmCount).toBe(1)
    expect(confirmedTrim).toEqual({ startMs: 2_000, endMs: 10_000 })

    render(null, root as unknown as Element)
    await new Promise((r) => setTimeout(r, 0))
  })

  test("revokes exactly the created object URL, exactly once, on unmount", async () => {
    const win = setupDom()
    const root = win.document.createElement("div")
    win.document.body.appendChild(root as unknown as Node)

    const created: string[] = []
    const revoked: string[] = []
    URL.createObjectURL = ((_blob: Blob) => {
      const url = `blob:trim-screen-test-${created.length}`
      created.push(url)
      return url
    }) as typeof URL.createObjectURL
    URL.revokeObjectURL = ((url: string) => {
      revoked.push(url)
    }) as typeof URL.revokeObjectURL

    render(
      h(TrimScreen, {
        blob: new Blob(["fake"], { type: "video/webm" }),
        durationMs: 10_000,
        onConfirm: () => {},
        onCancel: () => {},
      }),
      root as unknown as Element,
    )

    // Poll rather than a fixed tick: this is the passive mount effect (see
    // waitFor's doc comment above), which needs ~35ms+ to flush here, not 0.
    await waitFor(() => created.length > 0)
    expect(created).toEqual(["blob:trim-screen-test-0"])
    expect(revoked).toEqual([])

    // Cleanup runs synchronously as part of Preact's unmount lifecycle (not
    // the deferred passive-effect queue), so no extra wait is needed here —
    // but flush a tick anyway for parity with this file's other tests.
    render(null, root as unknown as Element)
    await new Promise((r) => setTimeout(r, 0))

    expect(revoked).toEqual(["blob:trim-screen-test-0"])
  })
})
