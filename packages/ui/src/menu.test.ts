import { afterEach, describe, expect, test } from "bun:test"
import { render } from "preact"
import { Window } from "happy-dom"
import { h } from "preact"
import { LauncherMenu } from "./menu"

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

function noop() {}

describe("LauncherMenu", () => {
  test("renders the three primary options plus a Gallery entry", () => {
    const win = setupDom()
    const root = win.document.createElement("div")
    win.document.body.appendChild(root as unknown as Node)

    render(
      h(LauncherMenu, {
        position: "bottom-right",
        onCapture: noop,
        onRecord: noop,
        onReport: noop,
        onGallery: noop,
        onClose: noop,
      }),
      root as unknown as Element,
    )

    expect(root.textContent).toContain("Capture")
    expect(root.textContent).toContain("Record screen")
    expect(root.textContent).toContain("Up to 5 minutes")
    expect(root.textContent).toContain("Report bug")
    expect(root.textContent).toContain("Gallery")
  })

  test("clicking each option fires its callback once and only once", () => {
    const win = setupDom()
    const root = win.document.createElement("div")
    win.document.body.appendChild(root as unknown as Node)

    let captureCount = 0
    let recordCount = 0
    let reportCount = 0
    let galleryCount = 0
    let closeCount = 0

    render(
      h(LauncherMenu, {
        position: "bottom-right",
        onCapture: () => {
          captureCount++
        },
        onRecord: () => {
          recordCount++
        },
        onReport: () => {
          reportCount++
        },
        onGallery: () => {
          galleryCount++
        },
        onClose: () => {
          closeCount++
        },
      }),
      root as unknown as Element,
    )

    const buttons = walkAllByTag(root as unknown as Element, "button") as unknown as HTMLElement[]
    const captureBtn = buttons.find((b) => b.textContent?.includes("Capture"))
    const recordBtn = buttons.find((b) => b.textContent?.includes("Record screen"))
    const reportBtn = buttons.find((b) => b.textContent?.includes("Report bug"))
    const galleryBtn = buttons.find((b) => b.textContent?.includes("Gallery"))
    expect(captureBtn).toBeTruthy()
    expect(recordBtn).toBeTruthy()
    expect(reportBtn).toBeTruthy()
    expect(galleryBtn).toBeTruthy()

    captureBtn?.click()
    captureBtn?.click()
    recordBtn?.click()
    reportBtn?.click()
    galleryBtn?.click()

    expect(captureCount).toBe(2)
    expect(recordCount).toBe(1)
    expect(reportCount).toBe(1)
    expect(galleryCount).toBe(1)
    // None of the option clicks should also fire onClose — that's a
    // distinct affordance (backdrop / explicit close), tested below.
    expect(closeCount).toBe(0)
  })

  test("clicking the backdrop fires onClose exactly once, without firing option callbacks", () => {
    const win = setupDom()
    const root = win.document.createElement("div")
    win.document.body.appendChild(root as unknown as Node)

    let closeCount = 0
    let captureCount = 0

    render(
      h(LauncherMenu, {
        position: "bottom-right",
        onCapture: () => {
          captureCount++
        },
        onRecord: noop,
        onReport: noop,
        onGallery: noop,
        onClose: () => {
          closeCount++
        },
      }),
      root as unknown as Element,
    )

    const backdrop = root.firstChild as HTMLElement
    expect(backdrop).toBeTruthy()
    backdrop.click()
    backdrop.click()

    expect(closeCount).toBe(2)
    expect(captureCount).toBe(0)
  })
})
