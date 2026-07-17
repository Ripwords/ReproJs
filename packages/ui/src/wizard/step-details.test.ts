/** @jsxImportSource preact */
import { describe, expect, test } from "bun:test"
import { render } from "preact"
import { Window } from "happy-dom"
import { StepDetails } from "./step-details"
import { h } from "preact"
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

// Walk DOM tree to find first element with the given tag name.
// Avoids attribute-selector querySelector which fails in happy-dom
// when SyntaxError is not bound on the window instance.
function walkForTag(node: Element, tag: string): Element | null {
  if (node.tagName?.toLowerCase() === tag) return node
  for (let i = 0; i < node.childNodes.length; i++) {
    const child = node.childNodes[i]
    if (child && (child as Element).tagName) {
      const found = walkForTag(child as Element, tag)
      if (found) return found
    }
  }
  return null
}

function walkForClass(node: Element, cls: string): Element | null {
  const classes = node.className?.split?.(" ") ?? []
  if (classes.includes(cls)) return node
  for (let i = 0; i < node.childNodes.length; i++) {
    const child = node.childNodes[i]
    if (child && (child as Element).tagName) {
      const found = walkForClass(child as Element, cls)
      if (found) return found
    }
  }
  return null
}

function baseProps() {
  return {
    title: "",
    description: "",
    attachments: [],
    attachmentErrors: [],
    mediaItems: [] as GalleryItem[],
    selectedMediaIds: [] as string[],
    mediaErrors: [] as string[],
    onTitleChange: () => {},
    onDescriptionChange: () => {},
    onAttachmentsAdd: () => {},
    onAttachmentRemove: () => {},
    onMediaToggle: () => {},
    onCaptureNow: () => {},
    onRecordNow: () => {},
  }
}

describe("StepDetails", () => {
  test("renders title + description fields with labels", () => {
    const win = setupDom()
    const root = win.document.createElement("div")
    win.document.body.appendChild(root as unknown as Node)
    render(h(StepDetails, baseProps()), root as unknown as Element)
    expect(root.textContent).toContain("Title")
    expect(root.textContent).toContain("Details")
    expect(walkForTag(root as unknown as Element, "input")).toBeTruthy()
    expect(walkForTag(root as unknown as Element, "textarea")).toBeTruthy()
  })

  test("calls onTitleChange when input fires", () => {
    const win = setupDom()
    const root = win.document.createElement("div")
    win.document.body.appendChild(root as unknown as Node)
    let captured = ""
    render(
      h(StepDetails, {
        ...baseProps(),
        onTitleChange: (v: string) => {
          captured = v
        },
      }),
      root as unknown as Element,
    )
    const input = walkForTag(root as unknown as Element, "input") as HTMLInputElement
    input.value = "hello"
    input.dispatchEvent(new win.Event("input", { bubbles: true }))
    expect(captured).toBe("hello")
  })

  test("renders the media section and forwards media props to MediaPicker", () => {
    const win = setupDom()
    const root = win.document.createElement("div")
    win.document.body.appendChild(root as unknown as Node)
    render(
      h(StepDetails, {
        ...baseProps(),
        mediaItems: [
          {
            id: "a",
            kind: "image",
            blob: new Blob(["x"], { type: "image/png" }),
            thumb: null,
            mime: "image/png",
            sizeBytes: 1024,
            createdAt: Date.now(),
          },
        ],
        mediaErrors: ["image exceeds 10 MB limit"],
      }),
      root as unknown as Element,
    )
    expect(root.textContent).toContain("Media")
    expect(walkForClass(root as unknown as Element, "ft-media")).toBeTruthy()
    expect(walkForClass(root as unknown as Element, "ft-media-item")).toBeTruthy()
    expect(walkForClass(root as unknown as Element, "ft-media-error")).toBeTruthy()
    expect(root.textContent).toContain("image exceeds 10 MB limit")
  })

  test("still renders AttachmentList", () => {
    const win = setupDom()
    const root = win.document.createElement("div")
    win.document.body.appendChild(root as unknown as Node)
    render(h(StepDetails, baseProps()), root as unknown as Element)
    expect(walkForClass(root as unknown as Element, "ft-attach")).toBeTruthy()
  })
})
