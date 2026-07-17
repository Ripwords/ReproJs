import { afterEach, describe, expect, test } from "bun:test"
import { render } from "preact"
import { Window } from "happy-dom"
import { h } from "preact"
import { RecordControlBar } from "./control-bar"

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

// Walk DOM tree collecting every element with the given tag, since
// querySelector/querySelectorAll throw in this happy-dom + bun setup (see
// step-review.test.ts's walkForClass, which sidesteps the same bug).
function walkAllByTag(node: Element, tag: string): Element[] {
  const out: Element[] = []
  if (node.tagName?.toLowerCase() === tag) out.push(node)
  for (let i = 0; i < node.childNodes.length; i++) {
    const child = node.childNodes[i]
    if (child && (child as Element).tagName) out.push(...walkAllByTag(child as Element, tag))
  }
  return out
}

describe("RecordControlBar", () => {
  test("shows elapsed / max as m:ss", () => {
    const win = setupDom()
    const root = win.document.createElement("div")
    win.document.body.appendChild(root as unknown as Node)

    render(
      h(RecordControlBar, {
        elapsedMs: 7_000,
        maxMs: 300_000,
        onStop: () => {},
        onCancel: () => {},
      }),
      root as unknown as Element,
    )

    expect(root.textContent).toContain("0:07 / 5:00")
  })

  test("clicking Stop and Cancel fires the matching callback exactly once", () => {
    const win = setupDom()
    const root = win.document.createElement("div")
    win.document.body.appendChild(root as unknown as Node)

    let stopCount = 0
    let cancelCount = 0

    render(
      h(RecordControlBar, {
        elapsedMs: 0,
        maxMs: 300_000,
        onStop: () => {
          stopCount++
        },
        onCancel: () => {
          cancelCount++
        },
      }),
      root as unknown as Element,
    )

    const buttons = walkAllByTag(root as unknown as Element, "button") as unknown as HTMLElement[]
    const stopBtn = buttons.find((b) => b.textContent?.includes("Stop"))
    const cancelBtn = buttons.find((b) => b.textContent?.includes("Cancel"))
    expect(stopBtn).toBeTruthy()
    expect(cancelBtn).toBeTruthy()

    stopBtn?.click()
    cancelBtn?.click()
    cancelBtn?.click()

    expect(stopCount).toBe(1)
    expect(cancelCount).toBe(2)
  })
})
