import AsyncStorage from "@react-native-async-storage/async-storage"
import type { ReportIntakeInput, AttachmentKind } from "@reprojs/shared"

const STORAGE_KEY = "@reprojs/expo/queue/v1"

export interface QueueItemAttachment {
  kind: AttachmentKind
  uri: string
  bytes: number
  filename?: string
  /** MIME type. Required for user-file entries; undefined for screenshot/replay. */
  contentType?: string
}

export interface QueueItem {
  id: string
  createdAt: string
  payload: {
    input: ReportIntakeInput
    attachments: QueueItemAttachment[]
    logs?: string
  }
  attempts: number
  lastErrorAt: string | null
  lastError: string | null
}

interface QueueFile {
  items: QueueItem[]
  sizeBytes: number
}

function itemBytes(i: QueueItem): number {
  return i.payload.attachments.reduce((sum, a) => sum + a.bytes, 0)
}

export interface QueueStorage {
  all: () => Promise<QueueItem[]>
  enqueue: (item: QueueItem) => Promise<{ evictedIds: string[] }>
  update: (id: string, patch: Partial<QueueItem>) => Promise<void>
  remove: (id: string) => Promise<void>
  clear: () => Promise<void>
}

function isQueueFile(value: unknown): value is QueueFile {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { items?: unknown }).items) &&
    typeof (value as { sizeBytes?: unknown }).sizeBytes === "number"
  )
}

async function read(): Promise<QueueFile> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY)
  if (!raw) return { items: [], sizeBytes: 0 }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    // The reports in it are gone either way; the next write replaces the
    // file. What must not happen is for that to be invisible.
    console.error(
      `[repro] queue file at ${STORAGE_KEY} is not valid JSON and will be discarded (${raw.length} chars)`,
      err,
    )
    return { items: [], sizeBytes: 0 }
  }
  if (!isQueueFile(parsed)) {
    console.error(
      `[repro] queue file at ${STORAGE_KEY} has an unexpected shape and will be discarded`,
    )
    return { items: [], sizeBytes: 0 }
  }
  return parsed
}

async function write(file: QueueFile): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(file))
}

export function createQueueStorage(opts: {
  maxReports: number
  maxBytes: number
  /**
   * Called with every item that leaves the queue, whichever way it goes:
   * `remove`, eviction inside `enqueue`, or `clear`. The provider uses it to
   * delete the attachment copies the item owns on disk. Runs after the queue
   * file is written; a rejection is logged, never propagated.
   */
  onRemove?: (item: QueueItem) => Promise<void> | void
}): QueueStorage {
  async function released(items: QueueItem[]) {
    for (const item of items) {
      try {
        // eslint-disable-next-line no-await-in-loop -- cleanup is sequential on purpose; it is file I/O on a phone
        await opts.onRemove?.(item)
      } catch (err) {
        console.warn(`[repro] queue cleanup failed for report ${item.id}`, err)
      }
    }
  }

  // Every operation is a read-modify-write of one AsyncStorage key, and the
  // flusher's remove/update overlap with the user's enqueue in practice. Chain
  // them so each sees the previous one's write; a rejected operation must not
  // poison the chain for the next caller.
  let chain: Promise<unknown> = Promise.resolve()
  function serialized<T>(op: () => Promise<T>): Promise<T> {
    const next = chain.then(op, op)
    chain = next
    return next
  }

  return {
    async all() {
      return serialized(async () => (await read()).items)
    },
    enqueue(item) {
      return serialized(async () => {
        const f = await read()
        const evicted: QueueItem[] = []
        f.items.push(item)
        f.sizeBytes += itemBytes(item)
        while (f.items.length > opts.maxReports || f.sizeBytes > opts.maxBytes) {
          const head = f.items.shift()
          if (!head) break
          evicted.push(head)
          f.sizeBytes -= itemBytes(head)
        }
        await write(f)
        await released(evicted)
        return { evictedIds: evicted.map((i) => i.id) }
      })
    },
    update(id, patch) {
      return serialized(async () => {
        const f = await read()
        const idx = f.items.findIndex((i) => i.id === id)
        if (idx === -1) return
        const current = f.items[idx]
        if (!current) return
        f.items[idx] = { ...current, ...patch }
        await write(f)
      })
    },
    remove(id) {
      return serialized(async () => {
        const f = await read()
        const idx = f.items.findIndex((i) => i.id === id)
        if (idx === -1) return
        const removed = f.items[idx]
        if (removed) f.sizeBytes -= itemBytes(removed)
        f.items.splice(idx, 1)
        await write(f)
        if (removed) await released([removed])
      })
    },
    clear() {
      return serialized(async () => {
        const f = await read()
        await AsyncStorage.removeItem(STORAGE_KEY)
        await released(f.items)
      })
    },
  }
}
