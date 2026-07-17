import { beforeEach, expect, test } from "bun:test"
import { IDBFactory } from "fake-indexeddb"
import { GALLERY_MAX_ITEMS, openGallery, type GalleryItem } from "./store"

let idb: IDBFactory
beforeEach(() => {
  idb = new IDBFactory() // fresh DB per test
})

function item(overrides: Partial<GalleryItem> = {}): GalleryItem {
  const blob = new Blob(["x".repeat(overrides.sizeBytes ?? 100)], { type: "image/png" })
  return {
    id: crypto.randomUUID(),
    kind: "image",
    blob,
    thumb: null,
    mime: "image/png",
    sizeBytes: blob.size,
    createdAt: Date.now(),
    ...overrides,
  }
}

test("add + list returns newest first", async () => {
  const store = (await openGallery({ indexedDB: idb }))!
  const a = item({ createdAt: 1000 })
  const b = item({ createdAt: 2000 })
  await store.add(a)
  await store.add(b)
  const all = await store.list()
  expect(all.map((i) => i.id)).toEqual([b.id, a.id])
})

test("get/update/remove roundtrip", async () => {
  const store = (await openGallery({ indexedDB: idb }))!
  const v = item({ kind: "video", mime: "video/webm", durationMs: 9000 })
  await store.add(v)
  await store.update(v.id, { trim: { startMs: 500, endMs: 8000 }, shareUrl: "https://x/s/tok" })
  const got = await store.get(v.id)
  expect(got?.trim).toEqual({ startMs: 500, endMs: 8000 })
  expect(got?.shareUrl).toBe("https://x/s/tok")
  await store.remove(v.id)
  expect(await store.get(v.id)).toBeNull()
})

test("evicts oldest past GALLERY_MAX_ITEMS", async () => {
  const store = (await openGallery({ indexedDB: idb }))!
  const items = Array.from({ length: GALLERY_MAX_ITEMS + 1 }, (_, i) => item({ createdAt: i + 1 }))
  let evicted: GalleryItem[] = []
  for (const it of items) {
    const r = await store.add(it) // eslint-disable-line no-await-in-loop -- sequential inserts are the behavior under test
    evicted = evicted.concat(r.evicted)
  }
  expect(evicted.map((e) => e.id)).toEqual([items[0]!.id])
  expect(await store.list()).toHaveLength(GALLERY_MAX_ITEMS)
})

test("evicts oldest past the byte budget", async () => {
  const store = (await openGallery({ indexedDB: idb }))!
  // Use a tiny injected budget via the exported test seam
  const big = item({ sizeBytes: 400 })
  const bigger = item({ sizeBytes: 400, createdAt: Date.now() + 1 })
  await store.add(big)
  const r = await store.add(bigger, /* maxTotalBytes test seam */ 600)
  expect(r.evicted.map((e) => e.id)).toEqual([big.id])
})

test("openGallery returns null without IndexedDB", async () => {
  expect(await openGallery({ indexedDB: undefined })).toBeNull()
})
