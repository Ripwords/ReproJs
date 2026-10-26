import { test, expect, mock } from "bun:test"

const memory = new Map<string, string>()
let failNextWrite = false
mock.module("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (k: string) => memory.get(k) ?? null,
    setItem: async (k: string, v: string) => {
      if (failNextWrite) {
        failNextWrite = false
        throw new Error("disk full")
      }
      memory.set(k, v)
    },
    removeItem: async (k: string) => {
      memory.delete(k)
    },
  },
}))

const { createQueueStorage } = await import("./storage")

test("enqueue persists and read returns items", async () => {
  memory.clear()
  const q = createQueueStorage({ maxReports: 5, maxBytes: 1024 * 1024 })
  await q.enqueue({
    id: "id-1",
    createdAt: new Date().toISOString(),
    payload: { input: { title: "t" } as never, attachments: [] },
    attempts: 0,
    lastErrorAt: null,
    lastError: null,
  })
  const items = await q.all()
  expect(items).toHaveLength(1)
  expect(items[0]?.id).toBe("id-1")
})

test("enqueue evicts the oldest when over maxReports", async () => {
  memory.clear()
  const q = createQueueStorage({ maxReports: 2, maxBytes: 1024 * 1024 })
  for (const id of ["a", "b", "c"]) {
    // eslint-disable-next-line no-await-in-loop -- sequential awaits asserted: eviction FIFO order depends on insertion order
    await q.enqueue({
      id,
      createdAt: new Date().toISOString(),
      payload: {
        input: { title: id } as never,
        attachments: [{ kind: "logs", uri: "file://x", bytes: 10 }],
      },
      attempts: 0,
      lastErrorAt: null,
      lastError: null,
    })
  }
  const items = await q.all()
  expect(items.map((i) => i.id)).toEqual(["b", "c"])
})

test("enqueue evicts when over maxBytes", async () => {
  memory.clear()
  const q = createQueueStorage({ maxReports: 10, maxBytes: 20 })
  await q.enqueue({
    id: "big",
    createdAt: new Date().toISOString(),
    payload: {
      input: { title: "t" } as never,
      attachments: [{ kind: "logs", uri: "file://x", bytes: 15 }],
    },
    attempts: 0,
    lastErrorAt: null,
    lastError: null,
  })
  await q.enqueue({
    id: "bigger",
    createdAt: new Date().toISOString(),
    payload: {
      input: { title: "t" } as never,
      attachments: [{ kind: "logs", uri: "file://y", bytes: 15 }],
    },
    attempts: 0,
    lastErrorAt: null,
    lastError: null,
  })
  const items = await q.all()
  expect(items.map((i) => i.id)).toEqual(["bigger"])
})

test("remove deletes by id", async () => {
  memory.clear()
  const q = createQueueStorage({ maxReports: 5, maxBytes: 1024 })
  await q.enqueue({
    id: "k",
    createdAt: new Date().toISOString(),
    payload: { input: { title: "t" } as never, attachments: [] },
    attempts: 0,
    lastErrorAt: null,
    lastError: null,
  })
  await q.remove("k")
  expect(await q.all()).toEqual([])
})

// Queued attachments are copies the SDK owns on disk. Whatever path takes an
// item out of the queue — a successful send, a drop, eviction of the oldest
// report, or clear() — must hand the item back so those files get deleted.
// Eviction is the easy one to forget: the caller only ever sees the ids.
const queued = (id: string) => ({
  id,
  createdAt: new Date().toISOString(),
  payload: { input: { title: id } as never, attachments: [] },
  attempts: 0,
  lastErrorAt: null,
  lastError: null,
})

test("onRemove receives every item that leaves the queue, including evictions", async () => {
  memory.clear()
  const removed: string[] = []
  const q = createQueueStorage({
    maxReports: 1,
    maxBytes: 1024,
    onRemove: async (item) => {
      removed.push(item.id)
    },
  })
  await q.enqueue(queued("a"))
  await q.enqueue(queued("b")) // evicts a
  expect(removed).toEqual(["a"])
  await q.remove("b")
  expect(removed).toEqual(["a", "b"])
  await q.remove("b") // already gone: no second callback
  expect(removed).toEqual(["a", "b"])
  await q.enqueue(queued("c"))
  await q.clear()
  expect(removed).toEqual(["a", "b", "c"])
})

test("a throwing onRemove does not prevent the queue from being updated", async () => {
  memory.clear()
  const q = createQueueStorage({
    maxReports: 5,
    maxBytes: 1024,
    onRemove: async () => {
      throw new Error("disk error")
    },
  })
  await q.enqueue({
    id: "x",
    createdAt: new Date().toISOString(),
    payload: { input: { title: "x" } as never, attachments: [] },
    attempts: 0,
    lastErrorAt: null,
    lastError: null,
  })
  await q.remove("x")
  expect(await q.all()).toEqual([])
})

// Every operation is read-modify-write on one AsyncStorage key. The flusher
// removes and updates items while the user can enqueue a new report at any
// moment; two overlapping operations both read the same snapshot and the
// second write throws away the first. Seen as: a report enqueued during a
// background flush vanishes, or a sent report comes back from the dead.
test("overlapping operations never lose or resurrect an item", async () => {
  memory.clear()
  const q = createQueueStorage({ maxReports: 10, maxBytes: 1024 })
  await q.enqueue(queued("sent"))
  await q.enqueue(queued("failing"))

  await Promise.all([
    q.remove("sent"), // flusher: 2xx for "sent"
    q.enqueue(queued("new-1")), // user submits a report mid-flush
    q.update("failing", { attempts: 1, lastError: "503" }), // flusher: retryable error
    q.enqueue(queued("new-2")), // and another one
  ])

  const items = await q.all()
  expect(items.map((i) => i.id)).toEqual(["failing", "new-1", "new-2"])
  expect(items[0]?.attempts).toBe(1)
})

test("a concurrent update does not revive an item that was removed first", async () => {
  memory.clear()
  const q = createQueueStorage({ maxReports: 10, maxBytes: 1024 })
  await q.enqueue(queued("gone"))
  await Promise.all([q.remove("gone"), q.update("gone", { attempts: 5 })])
  expect(await q.all()).toEqual([])
})

// Serialising through a promise chain has one classic failure: a rejected
// link blocks every later caller. A write that fails (disk full) must surface
// to its own caller and leave the queue usable.
test("a failed write does not block later operations", async () => {
  memory.clear()
  const q = createQueueStorage({ maxReports: 10, maxBytes: 1024 })
  failNextWrite = true
  await expect(q.enqueue(queued("lost"))).rejects.toThrow("disk full")
  await q.enqueue(queued("after"))
  expect((await q.all()).map((i) => i.id)).toEqual(["after"])
})

// A corrupt queue file was silently treated as empty. Whatever reports it
// held are gone either way, but that must show up somewhere.
test("a corrupt queue file is reported, then replaced by an empty queue", async () => {
  memory.clear()
  memory.set("@reprojs/expo/queue/v1", '{"items": [{"id": "half-written"')
  const errors: unknown[][] = []
  const originalError = console.error
  console.error = (...args: unknown[]) => {
    errors.push(args)
  }
  try {
    const q = createQueueStorage({ maxReports: 10, maxBytes: 1024 })
    expect(await q.all()).toEqual([])
    expect(errors).toHaveLength(1)
    // Shape that parses but is not a queue file (a different app version's
    // format, say) is corrupt too — not a crash on `.items.push`.
    memory.set("@reprojs/expo/queue/v1", '{"version": 2}')
    await q.enqueue(queued("fresh"))
    expect((await q.all()).map((i) => i.id)).toEqual(["fresh"])
    expect(errors).toHaveLength(2)
  } finally {
    console.error = originalError
  }
})
