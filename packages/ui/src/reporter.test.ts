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
  fields?: { relatedIssue: boolean }
  gallery?: GalleryStore | null
  sessionMedia?: GalleryItem[]
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
      sessionMedia: opts.sessionMedia ?? [],
      preselectedId: opts.preselectedId,
      fields: opts.fields,
      onCaptureNow: opts.onCaptureNow ?? (() => {}),
      onRecordNow: opts.onRecordNow ?? (() => {}),
    }),
    root as unknown as Element,
  )
  return root as unknown as Element
}

const RELATED_PLACEHOLDER = "#123 or issue URL"

function findInputByPlaceholder(root: Element, placeholder: string): HTMLInputElement | null {
  const input = collectByTag(root, "input").find(
    (el) => el.getAttribute("placeholder") === placeholder,
  )
  return (input as unknown as HTMLInputElement | undefined) ?? null
}

function typeInto(win: Window, input: HTMLInputElement, value: string) {
  input.value = value
  input.dispatchEvent(new win.Event("input", { bubbles: true }))
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

  test("gallery null hides the grid and the browse button, keeps Capture / Record now", async () => {
    const win = setupDom()
    const root = renderReporter(win, { gallery: null })
    await flush()
    expect(collectByClass(root, "ft-media-item").length).toBe(0)
    const buttons = collectByClass(root, "ft-btn-secondary")
    expect(buttons.some((b) => b.textContent === "Capture now")).toBe(true)
    expect(buttons.some((b) => b.textContent === "Record now")).toBe(true)
    expect(root.textContent).not.toContain("Choose from gallery")
  })

  test("renders this session's captures as chips", async () => {
    const win = setupDom()
    const root = renderReporter(win, {
      sessionMedia: [makeItem({ id: "a" }), makeItem({ id: "b" })],
    })
    await flush()
    expect(collectByClass(root, "ft-media-item").length).toBe(2)
  })

  // The complaint that drove this: every reported screenshot used to be written
  // to the gallery, and the Details step then rendered the entire gallery as a
  // chip grid. A saved archive must stay out of the wizard until asked for.
  test("does NOT render saved gallery items until the user browses", async () => {
    const win = setupDom()
    const saved = [makeItem({ id: "old-1" }), makeItem({ id: "old-2" })]
    const root = renderReporter(win, {
      gallery: makeGallery(saved),
      sessionMedia: [makeItem({ id: "fresh" })],
    })
    await flush()
    // Only the one captured in this flow.
    expect(collectByClass(root, "ft-media-item").length).toBe(1)
    expect(root.textContent).toContain("Choose from gallery")
  })

  test("browsing the gallery adds a chosen item to the picker, already-selected", async () => {
    const win = setupDom()
    const saved = [makeItem({ id: "old-1" }), makeItem({ id: "old-2" })]
    const root = renderReporter(win, { gallery: makeGallery(saved), sessionMedia: [] })
    await flush()

    findButtonByText(root, "Choose from gallery\u2026").click()
    await flush()
    // The sheet lists everything saved.
    expect(collectByClass(root, "ft-sheet-item").length).toBe(2)
    ;(collectByClass(root, "ft-sheet-item")[1] as unknown as HTMLElement).click()
    await flush()
    findButtonByText(root, "Add 1").click()
    await flush()

    // Sheet closed; the picked item is now a selected chip in the picker.
    expect(collectByClass(root, "ft-sheet-item").length).toBe(0)
    const chips = collectByClass(root, "ft-media-item")
    expect(chips.length).toBe(1)
    expect(collectByClass(root, "selected").length).toBe(1)

    await fillTitleAndContinue(win, root)
    expect(root.textContent).toContain("1 selected")
  })

  test("the browse sheet hides items already in the picker", async () => {
    const win = setupDom()
    const dupe = makeItem({ id: "dupe" })
    const root = renderReporter(win, {
      gallery: makeGallery([dupe, makeItem({ id: "other" })]),
      sessionMedia: [dupe],
    })
    await flush()
    findButtonByText(root, "Choose from gallery\u2026").click()
    await flush()
    expect(collectByClass(root, "ft-sheet-item").length).toBe(1)
  })

  test("preselectedId seeds the initial selection and reflects in the review summary", async () => {
    const win = setupDom()
    const items = [makeItem({ id: "pre-1" }), makeItem({ id: "other" })]
    const root = renderReporter(win, { sessionMedia: items, preselectedId: "pre-1" })
    await flush()
    expect(collectByClass(root, "selected").length).toBe(1)

    await fillTitleAndContinue(win, root)
    expect(root.textContent).toContain("1 selected")
  })

  test("prunes a stale preselectedId that isn't in this session's media", async () => {
    const win = setupDom()
    const items = [makeItem({ id: "real-1" })]
    let payload: Record<string, unknown> | undefined
    const root = renderReporter(win, {
      sessionMedia: items,
      preselectedId: "ghost-id",
      onSubmit: async (p) => {
        payload = p as Record<string, unknown>
        return { ok: true }
      },
    })
    await flush()

    // The ghost id matches nothing on offer, so nothing should read as
    // selected.
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
    const root = renderReporter(win, { sessionMedia: items })
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
      sessionMedia: items,
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

  test("a throwing onSubmit surfaces an error and re-enables Send instead of spinning forever", async () => {
    const win = setupDom()
    const root = renderReporter(win, {
      gallery: null,
      onSubmit: async () => {
        throw new ReferenceError("CompressionStream is not defined")
      },
    })
    await flush()
    await fillTitleAndContinue(win, root)
    findButtonByText(root, "Send report").click()
    await flush()

    expect(collectByClass(root, "ft-error-card")[0]?.textContent).toContain(
      "CompressionStream is not defined",
    )
    // Still on the review step with a usable Send button — not stuck on "Sending…".
    const send = findButtonByText(root, "Send report")
    expect(send.disabled).toBe(false)
    expect(findButtonByText(root, "Back").disabled).toBe(false)
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

  // The related-issue hint is a public, anonymous field: it must stay out of
  // the DOM entirely unless the host opted in, so existing embeds see no
  // change.
  test("does not render the related-issue field unless fields.relatedIssue is on", async () => {
    const win = setupDom()
    let payload: Record<string, unknown> | undefined
    const root = renderReporter(win, {
      gallery: null,
      onSubmit: async (p) => {
        payload = p as Record<string, unknown>
        return { ok: true }
      },
    })
    await flush()
    expect(findInputByPlaceholder(root, RELATED_PLACEHOLDER)).toBeNull()
    expect(root.textContent).not.toContain("Related GitHub issue")

    await fillTitleAndContinue(win, root)
    expect(root.textContent).not.toContain("Related issue")
    findButtonByText(root, "Send report").click()
    await flush()
    expect(payload).toBeTruthy()
    expect("relatedIssue" in (payload ?? {})).toBe(false)
  })

  test("sends the trimmed reference as relatedIssue and lists it in the review summary", async () => {
    const win = setupDom()
    let payload: Record<string, unknown> | undefined
    const root = renderReporter(win, {
      gallery: null,
      fields: { relatedIssue: true },
      onSubmit: async (p) => {
        payload = p as Record<string, unknown>
        return { ok: true }
      },
    })
    await flush()
    const related = findInputByPlaceholder(root, RELATED_PLACEHOLDER)
    if (!related) throw new Error("related-issue input missing")
    expect(related.maxLength).toBe(300)
    typeInto(win, related, "  #42 ")
    await flush()

    await fillTitleAndContinue(win, root)
    expect(root.textContent).toContain("Related issue")
    expect(root.textContent).toContain("#42")

    findButtonByText(root, "Send report").click()
    await flush()
    expect(payload?.relatedIssue).toBe("#42")
  })

  test("a reference that is not an issue blocks Continue until it parses or is cleared", async () => {
    const win = setupDom()
    let payload: Record<string, unknown> | undefined
    const root = renderReporter(win, {
      gallery: null,
      fields: { relatedIssue: true },
      onSubmit: async (p) => {
        payload = p as Record<string, unknown>
        return { ok: true }
      },
    })
    await flush()
    const title = walkForTag(root, "input") as unknown as HTMLInputElement
    typeInto(win, title, "Bug title")
    const related = findInputByPlaceholder(root, RELATED_PLACEHOLDER)
    if (!related) throw new Error("related-issue input missing")

    // A PR link is not an issue reference — blocked, with a hint.
    typeInto(win, related, "https://github.com/acme/app/pull/7")
    await flush()
    expect(findButtonByText(root, "Continue").disabled).toBe(true)
    expect(root.textContent).toContain("Enter an issue number like #123")

    // Fixing it to an issue URL unblocks and the hint goes away.
    typeInto(win, related, "https://github.com/acme/app/issues/7")
    await flush()
    expect(findButtonByText(root, "Continue").disabled).toBe(false)
    expect(root.textContent).not.toContain("Enter an issue number like #123")

    // Clearing it is also fine: an empty hint is simply not sent.
    typeInto(win, related, "   ")
    await flush()
    expect(findButtonByText(root, "Continue").disabled).toBe(false)
    findButtonByText(root, "Continue").click()
    await flush()
    expect(root.textContent).not.toContain("Related issue")
    findButtonByText(root, "Send report").click()
    await flush()
    expect(payload).toBeTruthy()
    expect(payload?.relatedIssue).toBeUndefined()
  })
})
