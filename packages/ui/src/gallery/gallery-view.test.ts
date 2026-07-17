import { afterEach, describe, expect, test } from "bun:test"
import { render } from "preact"
import { Window } from "happy-dom"
import { h } from "preact"
import { IDBFactory } from "fake-indexeddb"
import { openGallery, type GalleryItem, type GalleryStore } from "./store"
import { GalleryView } from "./gallery-view"

// Snapshot the real globals so each test's happy-dom Window doesn't bleed
// into unrelated test files that run later in the same bun:test process
// (bun:test shares one globalThis across all files unless restored).
const realDocument = globalThis.document
const realWindow = globalThis.window
// GalleryView's video preview calls the *global* URL.createObjectURL /
// revokeObjectURL (not window.URL) — same seam TrimScreen uses — so
// stubbing/restoring it is independent of setupDom/afterEach.
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

function walkAllByTag(node: Element, tag: string): Element[] {
  const out: Element[] = []
  if (node.tagName?.toLowerCase() === tag) out.push(node)
  for (let i = 0; i < node.childNodes.length; i++) {
    const child = node.childNodes[i]
    if (child && (child as Element).tagName) out.push(...walkAllByTag(child as Element, tag))
  }
  return out
}

async function waitFor(predicate: () => boolean, timeoutMs = 500): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) return // let the caller's own `expect` fail with a clear diff
    await new Promise((r) => setTimeout(r, 5))
  }
}

async function seedStore(): Promise<GalleryStore> {
  const store = (await openGallery({ indexedDB: new IDBFactory() }))!
  const imgBlob = new Blob(["img"], { type: "image/png" })
  const vidBlob = new Blob(["vid"], { type: "video/webm" })
  const image: GalleryItem = {
    id: "img-1",
    kind: "image",
    blob: imgBlob,
    thumb: null,
    mime: "image/png",
    sizeBytes: imgBlob.size,
    createdAt: 1000,
  }
  const video: GalleryItem = {
    id: "vid-1",
    kind: "video",
    blob: vidBlob,
    thumb: null,
    mime: "video/webm",
    sizeBytes: vidBlob.size,
    durationMs: 5_000,
    trim: { startMs: 1_000, endMs: 4_000 },
    createdAt: 2_000,
  }
  await store.add(image)
  await store.add(video)
  return store
}

function noop() {}

describe("GalleryView", () => {
  test("renders two tiles from a seeded store", async () => {
    const win = setupDom()
    const root = win.document.createElement("div")
    win.document.body.appendChild(root as unknown as Node)
    const store = await seedStore()

    render(
      h(GalleryView, {
        store,
        canShare: true,
        onCopyLink: async () => ({ url: "https://example.test/s/tok" }),
        onReportWith: noop,
        onClose: noop,
      }),
      root as unknown as Element,
    )

    await waitFor(() => walkAllByClass(root as unknown as Element, "ft-gallery-tile").length === 2)
    expect(walkAllByClass(root as unknown as Element, "ft-gallery-tile").length).toBe(2)
  })

  test("Copy link appears only on the video tile, and only when canShare is true", async () => {
    const win = setupDom()
    const root = win.document.createElement("div")
    win.document.body.appendChild(root as unknown as Node)
    const store = await seedStore()

    render(
      h(GalleryView, {
        store,
        canShare: true,
        onCopyLink: async () => ({ url: "https://example.test/s/tok" }),
        onReportWith: noop,
        onClose: noop,
      }),
      root as unknown as Element,
    )
    await waitFor(() => walkAllByClass(root as unknown as Element, "ft-gallery-tile").length === 2)

    const tiles = walkAllByClass(root as unknown as Element, "ft-gallery-tile")
    const imageTile = tiles.find((t) => t.getAttribute("data-kind") === "image")
    const videoTile = tiles.find((t) => t.getAttribute("data-kind") === "video")
    expect(imageTile).toBeTruthy()
    expect(videoTile).toBeTruthy()

    const imageButtons = walkAllByTag(imageTile as Element, "button") as unknown as HTMLElement[]
    const videoButtons = walkAllByTag(videoTile as Element, "button") as unknown as HTMLElement[]
    expect(imageButtons.some((b) => b.textContent?.includes("Copy link"))).toBe(false)
    expect(videoButtons.some((b) => b.textContent?.includes("Copy link"))).toBe(true)

    // Re-render with canShare: false — even the video tile loses the action.
    render(null, root as unknown as Element)
    render(
      h(GalleryView, {
        store,
        canShare: false,
        onCopyLink: async () => ({ url: "https://example.test/s/tok" }),
        onReportWith: noop,
        onClose: noop,
      }),
      root as unknown as Element,
    )
    await waitFor(() => walkAllByClass(root as unknown as Element, "ft-gallery-tile").length === 2)
    const allButtonsNoShare = walkAllByTag(
      root as unknown as Element,
      "button",
    ) as unknown as HTMLElement[]
    expect(allButtonsNoShare.some((b) => b.textContent?.includes("Copy link"))).toBe(false)
  })

  test("delete removes the tile from the DOM after settling", async () => {
    const win = setupDom()
    const root = win.document.createElement("div")
    win.document.body.appendChild(root as unknown as Node)
    const store = await seedStore()

    render(
      h(GalleryView, {
        store,
        canShare: true,
        onCopyLink: async () => ({ url: "https://example.test/s/tok" }),
        onReportWith: noop,
        onClose: noop,
      }),
      root as unknown as Element,
    )
    await waitFor(() => walkAllByClass(root as unknown as Element, "ft-gallery-tile").length === 2)

    const tiles = walkAllByClass(root as unknown as Element, "ft-gallery-tile")
    const imageTile = tiles.find((t) => t.getAttribute("data-kind") === "image") as Element
    const deleteBtn = (walkAllByTag(imageTile, "button") as unknown as HTMLElement[]).find((b) =>
      b.textContent?.includes("Delete"),
    )
    expect(deleteBtn).toBeTruthy()
    deleteBtn?.click()

    await waitFor(() => walkAllByClass(root as unknown as Element, "ft-gallery-tile").length === 1)
    const remaining = walkAllByClass(root as unknown as Element, "ft-gallery-tile")
    expect(remaining.length).toBe(1)
    expect(remaining[0]?.getAttribute("data-kind")).toBe("video")

    // Also gone from the store itself, not just the DOM.
    expect(await store.list()).toHaveLength(1)
  })

  test("fails open with an empty grid when the store is null (IndexedDB unavailable)", async () => {
    const win = setupDom()
    const root = win.document.createElement("div")
    win.document.body.appendChild(root as unknown as Node)

    render(
      h(GalleryView, {
        store: null,
        canShare: true,
        onCopyLink: async () => ({ url: "https://example.test/s/tok" }),
        onReportWith: noop,
        onClose: noop,
      }),
      root as unknown as Element,
    )

    await new Promise((r) => setTimeout(r, 20))
    expect(walkAllByClass(root as unknown as Element, "ft-gallery-tile").length).toBe(0)
  })

  test("video preview clamps playback to trim and revokes the object URL on close", async () => {
    const win = setupDom()
    const root = win.document.createElement("div")
    win.document.body.appendChild(root as unknown as Node)
    const store = await seedStore()

    const created: string[] = []
    const revoked: string[] = []
    URL.createObjectURL = ((_blob: Blob) => {
      const url = `blob:gallery-test-${created.length}`
      created.push(url)
      return url
    }) as typeof URL.createObjectURL
    URL.revokeObjectURL = ((url: string) => {
      revoked.push(url)
    }) as typeof URL.revokeObjectURL

    render(
      h(GalleryView, {
        store,
        canShare: true,
        onCopyLink: async () => ({ url: "https://example.test/s/tok" }),
        onReportWith: noop,
        onClose: noop,
      }),
      root as unknown as Element,
    )
    await waitFor(() => walkAllByClass(root as unknown as Element, "ft-gallery-tile").length === 2)

    const tiles = walkAllByClass(root as unknown as Element, "ft-gallery-tile")
    const videoTile = tiles.find((t) => t.getAttribute("data-kind") === "video") as Element
    const previewBtn = (walkAllByTag(videoTile, "button") as unknown as HTMLElement[]).find((b) =>
      b.textContent?.includes("Preview"),
    )
    expect(previewBtn).toBeTruthy()
    previewBtn?.click()

    await waitFor(() => created.length > 0)
    expect(created).toEqual(["blob:gallery-test-0"])

    const video = walkAllByTag(root as unknown as Element, "video")[0] as unknown as
      | HTMLVideoElement
      | undefined
    expect(video).toBeTruthy()

    // trim.startMs is 1_000 — loadedmetadata should seek there.
    video?.dispatchEvent(new win.Event("loadedmetadata"))
    await new Promise((r) => setTimeout(r, 0))
    expect(video?.currentTime).toBe(1)

    // trim.endMs is 4_000 — crossing it during playback should pause.
    let pauseCalls = 0
    if (video)
      video.pause = () => {
        pauseCalls++
      }
    Object.defineProperty(video, "currentTime", { value: 4, configurable: true })
    video?.dispatchEvent(new win.Event("timeupdate"))
    await new Promise((r) => setTimeout(r, 0))
    expect(pauseCalls).toBe(1)

    // Closing the preview (clicking Preview again) unmounts the <video> and
    // must revoke exactly the URL it created.
    previewBtn?.click()
    await waitFor(() => revoked.length > 0)
    expect(revoked).toEqual(["blob:gallery-test-0"])
  })
})
