import type { TrimRange } from "@reprojs/sdk-utils"

export interface GalleryItem {
  id: string
  kind: "image" | "video"
  blob: Blob
  thumb: Blob | null
  mime: string
  sizeBytes: number
  durationMs?: number
  trim?: TrimRange
  createdAt: number
  shareUrl?: string
  shareToken?: string
  shareExpiresAt?: string
}

export const GALLERY_MAX_ITEMS = 50
export const GALLERY_MAX_TOTAL_BYTES = 500 * 1024 * 1024
const DB_NAME = "repro-gallery"
const STORE = "media"

export interface GalleryStore {
  add(item: GalleryItem, maxTotalBytes?: number): Promise<{ evicted: GalleryItem[] }>
  list(): Promise<GalleryItem[]>
  get(id: string): Promise<GalleryItem | null>
  update(
    id: string,
    patch: Partial<Pick<GalleryItem, "trim" | "shareUrl" | "shareToken" | "shareExpiresAt">>,
  ): Promise<void>
  remove(id: string): Promise<void>
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.addEventListener("success", () => resolve(r.result), { once: true })
    r.addEventListener("error", () => reject(r.error), { once: true })
  })
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.addEventListener("complete", () => resolve(), { once: true })
    tx.addEventListener("abort", () => reject(tx.error), { once: true })
    tx.addEventListener("error", () => reject(tx.error), { once: true })
  })
}

/** Resolves null when IndexedDB is unavailable — callers must fail open. */
export async function openGallery(deps?: { indexedDB?: IDBFactory }): Promise<GalleryStore | null> {
  const factory = deps ? deps.indexedDB : globalThis.indexedDB
  if (!factory) return null
  let db: IDBDatabase
  try {
    const open = factory.open(DB_NAME, 1)
    open.addEventListener(
      "upgradeneeded",
      () => {
        const store = open.result.createObjectStore(STORE, { keyPath: "id" })
        store.createIndex("createdAt", "createdAt")
      },
      { once: true },
    )
    db = await req(open as IDBRequest<IDBDatabase>)
  } catch {
    return null
  }

  const listAll = async (): Promise<GalleryItem[]> => {
    const tx = db.transaction(STORE, "readonly")
    const rows = await req(tx.objectStore(STORE).getAll() as IDBRequest<GalleryItem[]>)
    return rows.toSorted((a, b) => b.createdAt - a.createdAt)
  }

  return {
    async add(item, maxTotalBytes = GALLERY_MAX_TOTAL_BYTES) {
      const existing = await listAll()
      const evicted: GalleryItem[] = []
      // Evict oldest-first until both budgets fit the incoming item.
      let count = existing.length + 1
      let bytes = existing.reduce((n, i) => n + i.sizeBytes, 0) + item.sizeBytes
      for (
        let i = existing.length - 1;
        i >= 0 && (count > GALLERY_MAX_ITEMS || bytes > maxTotalBytes);
        i--
      ) {
        const victim = existing[i]!
        evicted.push(victim)
        count--
        bytes -= victim.sizeBytes
      }
      const tx = db.transaction(STORE, "readwrite")
      const store = tx.objectStore(STORE)
      for (const v of evicted) store.delete(v.id)
      store.put(item)
      await txDone(tx)
      return { evicted }
    },
    list: listAll,
    async get(id) {
      const tx = db.transaction(STORE, "readonly")
      const row = await req(tx.objectStore(STORE).get(id) as IDBRequest<GalleryItem | undefined>)
      return row ?? null
    },
    async update(id, patch) {
      const tx = db.transaction(STORE, "readwrite")
      const store = tx.objectStore(STORE)
      const row = await req(store.get(id) as IDBRequest<GalleryItem | undefined>)
      if (row) store.put({ ...row, ...patch })
      await txDone(tx)
    },
    async remove(id) {
      const tx = db.transaction(STORE, "readwrite")
      tx.objectStore(STORE).delete(id)
      await txDone(tx)
    },
  }
}
