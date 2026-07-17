/** @jsxImportSource preact */
import { describe, expect, test } from "bun:test"
import { render } from "preact"
import { Window } from "happy-dom"
import { h } from "preact"
import { MediaPicker } from "./media-picker"
import type { GalleryItem } from "../gallery/store"

function setupDom() {
  const win = new Window()
  // @ts-expect-error happy-dom Window has the DOM globals we need
  globalThis.document = win.document
  // @ts-expect-error
  globalThis.window = win
  // @ts-expect-error
  globalThis.HTMLElement = win.HTMLElement
  // @ts-expect-error
  globalThis.Event = win.Event
  return win
}

// Walk DOM tree collecting every element with the given class. Mirrors the
// walkForClass helper used across the other wizard tests, but returns all
// matches instead of the first — needed here because a chip grid and the
// two action buttons both live under the same component.
function collectByClass(node: Element, cls: string, out: Element[] = []): Element[] {
  const classes = node.className?.split?.(" ") ?? []
  if (classes.includes(cls)) out.push(node)
  for (let i = 0; i < node.childNodes.length; i++) {
    const child = node.childNodes[i]
    if (child && (child as Element).tagName) collectByClass(child as Element, cls, out)
  }
  return out
}

function makeItem(overrides: Partial<GalleryItem> = {}): GalleryItem {
  return {
    id: "item-1",
    kind: "image",
    blob: new Blob(["x"], { type: "image/png" }),
    thumb: null,
    mime: "image/png",
    sizeBytes: 1024,
    createdAt: Date.now(),
    ...overrides,
  }
}

describe("MediaPicker", () => {
  test("renders one chip per item", () => {
    const win = setupDom()
    const root = win.document.createElement("div")
    win.document.body.appendChild(root as unknown as Node)
    const items = [makeItem({ id: "a" }), makeItem({ id: "b" }), makeItem({ id: "c" })]
    render(
      h(MediaPicker, {
        items,
        selectedIds: [],
        errors: [],
        onToggle: () => {},
        onCaptureNow: () => {},
        onRecordNow: () => {},
      }),
      root as unknown as Element,
    )
    const chips = collectByClass(root as unknown as Element, "ft-media-item")
    expect(chips.length).toBe(3)
  })

  test("marks selected items with the selected class", () => {
    const win = setupDom()
    const root = win.document.createElement("div")
    win.document.body.appendChild(root as unknown as Node)
    const items = [makeItem({ id: "a" }), makeItem({ id: "b" })]
    render(
      h(MediaPicker, {
        items,
        selectedIds: ["b"],
        errors: [],
        onToggle: () => {},
        onCaptureNow: () => {},
        onRecordNow: () => {},
      }),
      root as unknown as Element,
    )
    const chips = collectByClass(root as unknown as Element, "ft-media-item")
    const selected = collectByClass(root as unknown as Element, "selected")
    expect(chips.length).toBe(2)
    expect(selected.length).toBe(1)
  })

  test("fires onToggle with the item id when a chip is clicked", () => {
    const win = setupDom()
    const root = win.document.createElement("div")
    win.document.body.appendChild(root as unknown as Node)
    const items = [makeItem({ id: "a" }), makeItem({ id: "b" })]
    let toggled: string | null = null
    render(
      h(MediaPicker, {
        items,
        selectedIds: [],
        errors: [],
        onToggle: (id: string) => {
          toggled = id
        },
        onCaptureNow: () => {},
        onRecordNow: () => {},
      }),
      root as unknown as Element,
    )
    const chips = collectByClass(root as unknown as Element, "ft-media-item")
    ;(chips[1] as unknown as HTMLElement).click()
    expect(toggled).toBe("b")
  })

  test("fires onCaptureNow and onRecordNow when the action buttons are clicked", () => {
    const win = setupDom()
    const root = win.document.createElement("div")
    win.document.body.appendChild(root as unknown as Node)
    let capturedNow = false
    let recordedNow = false
    render(
      h(MediaPicker, {
        items: [],
        selectedIds: [],
        errors: [],
        onToggle: () => {},
        onCaptureNow: () => {
          capturedNow = true
        },
        onRecordNow: () => {
          recordedNow = true
        },
      }),
      root as unknown as Element,
    )
    const buttons = collectByClass(root as unknown as Element, "ft-btn-secondary")
    const captureBtn = buttons.find((b) => b.textContent === "Capture now")
    const recordBtn = buttons.find((b) => b.textContent === "Record now")
    expect(captureBtn).toBeTruthy()
    expect(recordBtn).toBeTruthy()
    ;(captureBtn as unknown as HTMLElement).click()
    ;(recordBtn as unknown as HTMLElement).click()
    expect(capturedNow).toBe(true)
    expect(recordedNow).toBe(true)
  })

  test("renders an empty state when there are no items, but keeps the action buttons", () => {
    const win = setupDom()
    const root = win.document.createElement("div")
    win.document.body.appendChild(root as unknown as Node)
    render(
      h(MediaPicker, {
        items: [],
        selectedIds: [],
        errors: [],
        onToggle: () => {},
        onCaptureNow: () => {},
        onRecordNow: () => {},
      }),
      root as unknown as Element,
    )
    expect(collectByClass(root as unknown as Element, "ft-media-item").length).toBe(0)
    expect(collectByClass(root as unknown as Element, "ft-btn-secondary").length).toBe(2)
  })

  test("renders the errors list when present", () => {
    const win = setupDom()
    const root = win.document.createElement("div")
    win.document.body.appendChild(root as unknown as Node)
    render(
      h(MediaPicker, {
        items: [],
        selectedIds: [],
        errors: ["At most 3 media items per report"],
        onToggle: () => {},
        onCaptureNow: () => {},
        onRecordNow: () => {},
      }),
      root as unknown as Element,
    )
    expect(root.textContent).toContain("At most 3 media items per report")
    expect(collectByClass(root as unknown as Element, "ft-media-error").length).toBe(1)
  })
})
