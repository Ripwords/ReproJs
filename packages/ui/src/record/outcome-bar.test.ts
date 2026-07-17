import { afterEach, describe, expect, test } from "bun:test"
import { render } from "preact"
import { Window } from "happy-dom"
import { h } from "preact"
import { OutcomeBar } from "./outcome-bar"

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

describe("OutcomeBar", () => {
  test("renders Save / Discard / Report labels", () => {
    const win = setupDom()
    const root = win.document.createElement("div")
    win.document.body.appendChild(root as unknown as Node)

    render(
      h(OutcomeBar, { kind: "video", onSave: () => {}, onDiscard: () => {}, onReport: () => {} }),
      root as unknown as Element,
    )

    expect(root.textContent).toContain("Save to gallery")
    expect(root.textContent).toContain("Discard")
    expect(root.textContent).toContain("Report bug with this")
  })

  test("clicking Save/Discard/Report fires the matching callback exactly once", () => {
    const win = setupDom()
    const root = win.document.createElement("div")
    win.document.body.appendChild(root as unknown as Node)

    let saveCount = 0
    let discardCount = 0
    let reportCount = 0

    render(
      h(OutcomeBar, {
        kind: "image",
        onSave: () => {
          saveCount++
        },
        onDiscard: () => {
          discardCount++
        },
        onReport: () => {
          reportCount++
        },
      }),
      root as unknown as Element,
    )

    const buttons = walkAllByTag(root as unknown as Element, "button") as unknown as HTMLElement[]
    const saveBtn = buttons.find((b) => b.textContent?.includes("Save to gallery"))
    const discardBtn = buttons.find((b) => b.textContent?.includes("Discard"))
    const reportBtn = buttons.find((b) => b.textContent?.includes("Report bug with this"))
    expect(saveBtn).toBeTruthy()
    expect(discardBtn).toBeTruthy()
    expect(reportBtn).toBeTruthy()

    saveBtn?.click()
    discardBtn?.click()
    reportBtn?.click()
    reportBtn?.click()

    expect(saveCount).toBe(1)
    expect(discardCount).toBe(1)
    expect(reportCount).toBe(2)
  })
})
