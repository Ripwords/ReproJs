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
})

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
})
