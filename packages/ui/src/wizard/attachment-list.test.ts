/** @jsxImportSource preact */
import { describe, expect, test } from "bun:test"
import { render } from "preact"
import { Window } from "happy-dom"
import { h } from "preact"
import { AttachmentList } from "./attachment-list"
import { DEFAULT_ATTACHMENT_LIMITS, type Attachment } from "@reprojs/sdk-utils"

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

// Walk DOM tree to find first element with the given class.
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

function makeAttachment(overrides: Partial<Attachment> = {}): Attachment {
  return {
    id: "test-id-1",
    blob: new Blob(["data"], { type: "image/png" }),
    filename: "screenshot.png",
    mime: "image/png",
    size: 4,
    isImage: true,
    previewUrl: "blob:test",
    ...overrides,
  }
}

describe("AttachmentList", () => {
  test("renders the dropzone when not at cap, hinting at click + paste", () => {
    const win = setupDom()
    const root = win.document.createElement("div")
    win.document.body.appendChild(root as unknown as Node)
    render(
      h(AttachmentList, {
        attachments: [],
        limits: DEFAULT_ATTACHMENT_LIMITS,
        onAdd: () => {},
        onRemove: () => {},
      }),
      root as unknown as Element,
    )
    const dropzone = walkForClass(root as unknown as Element, "ft-attach-dropzone")
    expect(dropzone).toBeTruthy()
    expect((dropzone as HTMLButtonElement).disabled).toBe(false)
    expect(dropzone?.textContent).toContain("Click to add files")
    expect(dropzone?.textContent).toContain("paste")
  })

  test("disables dropzone at maxCount and shows count text", () => {
    const win = setupDom()
    const root = win.document.createElement("div")
    win.document.body.appendChild(root as unknown as Node)
    const limits = { ...DEFAULT_ATTACHMENT_LIMITS, maxCount: 5 }
    const attachments: Attachment[] = [
      makeAttachment({ id: "a1", filename: "a.png" }),
      makeAttachment({ id: "a2", filename: "b.png" }),
      makeAttachment({ id: "a3", filename: "c.png" }),
      makeAttachment({ id: "a4", filename: "d.png" }),
      makeAttachment({ id: "a5", filename: "e.png" }),
    ]
    render(
      h(AttachmentList, {
        attachments,
        limits,
        onAdd: () => {},
        onRemove: () => {},
      }),
      root as unknown as Element,
    )
    const dropzone = walkForClass(root as unknown as Element, "ft-attach-dropzone")
    expect(dropzone).toBeTruthy()
    expect((dropzone as HTMLButtonElement).disabled).toBe(true)
    expect(dropzone?.textContent).toContain("5 of 5")
  })

  test("calls onRemove with attachment id when remove button is clicked", () => {
    const win = setupDom()
    const root = win.document.createElement("div")
    win.document.body.appendChild(root as unknown as Node)
    let removedId = ""
    const att = makeAttachment({ id: "remove-me", filename: "test.png" })
    render(
      h(AttachmentList, {
        attachments: [att],
        limits: DEFAULT_ATTACHMENT_LIMITS,
        onAdd: () => {},
        onRemove: (id: string) => {
          removedId = id
        },
      }),
      root as unknown as Element,
    )
    const removeBtn = walkForClass(root as unknown as Element, "ft-attach-remove")
    expect(removeBtn).toBeTruthy()
    removeBtn?.dispatchEvent(new win.Event("click", { bubbles: true }))
    expect(removedId).toBe("remove-me")
  })

  // Thumbnails must render straight from the blob, never via a blob: object
  // URL in <img src> — host CSPs with `img-src 'self' data:` refuse those, so
  // previewUrl is deliberately absent here to prove it isn't relied on.
  test("renders thumbnail for image attachments and icon for non-images", () => {
    const win = setupDom()
    const root = win.document.createElement("div")
    win.document.body.appendChild(root as unknown as Node)
    const imageAtt = makeAttachment({ id: "img-1", isImage: true, previewUrl: undefined })
    const fileAtt = makeAttachment({
      id: "file-1",
      filename: "doc.pdf",
      mime: "application/pdf",
      isImage: false,
      previewUrl: undefined,
    })
    render(
      h(AttachmentList, {
        attachments: [imageAtt, fileAtt],
        limits: DEFAULT_ATTACHMENT_LIMITS,
        onAdd: () => {},
        onRemove: () => {},
      }),
      root as unknown as Element,
    )
    const thumb = walkForClass(root as unknown as Element, "ft-attach-thumb")
    expect(thumb).toBeTruthy()
    expect(thumb?.tagName?.toLowerCase()).toBe("canvas")
    const icon = walkForClass(root as unknown as Element, "ft-attach-icon")
    expect(icon).toBeTruthy()
  })
})
