/** @jsxImportSource preact */
import { describe, expect, test } from "bun:test"
import { render } from "preact"
import { Window } from "happy-dom"
import { h } from "preact"
import { Reporter, type ReporterSubmitResult } from "./reporter"
import type { GalleryItem, GalleryStore } from "./gallery/store"

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

// Flush pending microtasks/effects (gallery.list() resolution, preact's
// post-commit effect scheduling) — mirrors the setTimeout-based flush used
// by wizard/step-annotate.test.ts for the same class of async-effect wait.
function flush(ms = 50): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

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

function collectByTag(node: Element, tag: string, out: Element[] = []): Element[] {
  if (node.tagName?.toLowerCase() === tag) out.push(node)
  for (let i = 0; i < node.childNodes.length; i++) {
    const child = node.childNodes[i]
    if (child && (child as Element).tagName) collectByTag(child as Element, tag, out)
  }
  return out
}

function collectByClass(node: Element, cls: string, out: Element[] = []): Element[] {
  const classes = node.className?.split?.(" ") ?? []
  if (classes.includes(cls)) out.push(node)
  for (let i = 0; i < node.childNodes.length; i++) {
    const child = node.childNodes[i]
    if (child && (child as Element).tagName) collectByClass(child as Element, cls, out)
  }
  return out
}

function findButtonByText(root: Element, text: string): HTMLButtonElement {
  const btn = collectByTag(root, "button").find((b) => b.textContent?.trim() === text)
  if (!btn) throw new Error(`No <button> with text "${text}"`)
  return btn as unknown as HTMLButtonElement
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

function makeGallery(items: GalleryItem[]): GalleryStore {
  return {
    async add(item) {
      items.push(item)
      return { evicted: [] }
    },
    async list() {
      return items
    },
    async get(id) {
      return items.find((i) => i.id === id) ?? null
    },
    async update() {},
    async remove(id) {
      const idx = items.findIndex((i) => i.id === id)
      if (idx >= 0) items.splice(idx, 1)
    },
  }
}

interface RenderOpts {
  gallery?: GalleryStore | null
  preselectedId?: string
  onSubmit?: (payload: unknown) => Promise<ReporterSubmitResult>
  onCaptureNow?: () => void
  onRecordNow?: () => void
  onClose?: () => void
}

function renderReporter(win: Window, opts: RenderOpts = {}) {
  const root = win.document.createElement("div")
  win.document.body.appendChild(root as unknown as Node)
  render(
    h(Reporter, {
      onClose: opts.onClose ?? (() => {}),
      onSubmit: (opts.onSubmit ?? (async () => ({ ok: true }))) as never,
      openedAt: performance.now(),
      gallery: opts.gallery ?? null,
      preselectedId: opts.preselectedId,
      onCaptureNow: opts.onCaptureNow ?? (() => {}),
      onRecordNow: opts.onRecordNow ?? (() => {}),
    }),
    root as unknown as Element,
  )
  return root as unknown as Element
}

async function fillTitleAndContinue(win: Window, root: Element) {
  const input = walkForTag(root, "input") as unknown as HTMLInputElement
  input.value = "Bug title"
  input.dispatchEvent(new win.Event("input", { bubbles: true }))
  await flush()
  findButtonByText(root, "Continue").click()
  await flush()
}

describe("Reporter", () => {
  test('renders the Details step first and never shows "Capturing…"', async () => {
    const win = setupDom()
    const root = renderReporter(win)
    await flush()
    expect(root.textContent).not.toContain("Capturing…")
    expect(root.textContent).not.toContain("Annotate")
    expect(walkForTag(root, "textarea")).toBeTruthy()
    expect(walkForTag(root, "input")).toBeTruthy()
  })

  test("gallery null hides the media grid but keeps Capture now / Record now", async () => {
    const win = setupDom()
    const root = renderReporter(win, { gallery: null })
    await flush()
    expect(collectByClass(root, "ft-media-item").length).toBe(0)
    const buttons = collectByClass(root, "ft-btn-secondary")
    expect(buttons.some((b) => b.textContent === "Capture now")).toBe(true)
    expect(buttons.some((b) => b.textContent === "Record now")).toBe(true)
  })

  test("loads gallery items on mount and renders them as chips", async () => {
    const win = setupDom()
    const items = [makeItem({ id: "a" }), makeItem({ id: "b" })]
    const root = renderReporter(win, { gallery: makeGallery(items) })
    await flush()
    expect(collectByClass(root, "ft-media-item").length).toBe(2)
  })

  test("preselectedId seeds the initial selection and reflects in the review summary", async () => {
    const win = setupDom()
    const items = [makeItem({ id: "pre-1" }), makeItem({ id: "other" })]
    const root = renderReporter(win, { gallery: makeGallery(items), preselectedId: "pre-1" })
    await flush()
    expect(collectByClass(root, "selected").length).toBe(1)

    await fillTitleAndContinue(win, root)
    expect(root.textContent).toContain("1 selected")
  })

  test("prunes a stale preselectedId that isn't in the loaded gallery", async () => {
    const win = setupDom()
    const items = [makeItem({ id: "real-1" })]
    let payload: Record<string, unknown> | undefined
    const root = renderReporter(win, {
      gallery: makeGallery(items),
      preselectedId: "ghost-id",
      onSubmit: async (p) => {
        payload = p as Record<string, unknown>
        return { ok: true }
      },
    })
    await flush()

    // The ghost id was never a real gallery item, so nothing should read as
    // selected once the load effect resolves.
    expect(collectByClass(root, "selected").length).toBe(0)

    await fillTitleAndContinue(win, root)
    expect(root.textContent).not.toContain("Media")

    findButtonByText(root, "Send report").click()
    await flush()

    expect(payload).toBeTruthy()
    expect(payload?.media).toEqual([])
  })

  test("blocks selection past the media limit and clears errors on a later valid toggle", async () => {
    const win = setupDom()
    const items = ["a", "b", "c", "d"].map((id) => makeItem({ id }))
    const root = renderReporter(win, { gallery: makeGallery(items) })
    await flush()

    let chips = collectByClass(root, "ft-media-item")
    expect(chips.length).toBe(4)
    ;(chips[0] as unknown as HTMLElement).click()
    await flush()
    ;(chips[1] as unknown as HTMLElement).click()
    await flush()
    ;(chips[2] as unknown as HTMLElement).click()
    await flush()
    expect(collectByClass(root, "selected").length).toBe(3)
    expect(collectByClass(root, "ft-media-error").length).toBe(0)

    // 4th selection exceeds MEDIA_LIMITS.maxCount (3) — blocked, errors shown.
    chips = collectByClass(root, "ft-media-item")
    ;(chips[3] as unknown as HTMLElement).click()
    await flush()
    expect(collectByClass(root, "selected").length).toBe(3)
    expect(root.textContent).toContain("At most 3 media items per report")

    // Deselecting one is a valid toggle (count only drops) — clears the error.
    chips = collectByClass(root, "ft-media-item")
    ;(chips[0] as unknown as HTMLElement).click()
    await flush()
    expect(collectByClass(root, "selected").length).toBe(2)
    expect(collectByClass(root, "ft-media-error").length).toBe(0)
  })

  test("submit payload carries selected media (not screenshot), attachments, dwell, and honeypot", async () => {
    const win = setupDom()
    const items = [makeItem({ id: "a" }), makeItem({ id: "b" })]
    let payload: Record<string, unknown> | undefined
    const root = renderReporter(win, {
      gallery: makeGallery(items),
      onSubmit: async (p) => {
        payload = p as Record<string, unknown>
        return { ok: true }
      },
    })
    await flush()
    ;(collectByClass(root, "ft-media-item")[0] as unknown as HTMLElement).click()
    await flush()

    await fillTitleAndContinue(win, root)
    findButtonByText(root, "Send report").click()
    await flush()

    expect(payload).toBeTruthy()
    expect(payload?.screenshot).toBeUndefined()
    const media = payload?.media as GalleryItem[]
    expect(media).toHaveLength(1)
    expect(media[0]?.id).toBe("a")
    expect(Array.isArray(payload?.attachments)).toBe(true)
    expect(typeof payload?.dwellMs).toBe("number")
    expect(payload?.honeypot).toBe("")
  })

  test("omits the Media summary line when nothing is selected", async () => {
    const win = setupDom()
    const root = renderReporter(win, { gallery: null })
    await flush()
    await fillTitleAndContinue(win, root)
    expect(root.textContent).not.toContain("Media")
  })

  test("wires onCaptureNow / onRecordNow through to the Details step buttons", async () => {
    const win = setupDom()
    let capturedNow = false
    let recordedNow = false
    const root = renderReporter(win, {
      gallery: null,
      onCaptureNow: () => {
        capturedNow = true
      },
      onRecordNow: () => {
        recordedNow = true
      },
    })
    await flush()
    findButtonByText(root, "Capture now").click()
    findButtonByText(root, "Record now").click()
    expect(capturedNow).toBe(true)
    expect(recordedNow).toBe(true)
  })
})
