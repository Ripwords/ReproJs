import { test, expect, mock } from "bun:test"

const memory = new Map<string, string>()
mock.module("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (k: string) => memory.get(k) ?? null,
    setItem: async (k: string, v: string) => {
      memory.set(k, v)
    },
    removeItem: async (k: string) => {
      memory.delete(k)
    },
  },
}))

const { createQueueFlusher } = await import("./flush")
const { createQueueStorage } = await import("./storage")
type IntakeClient = import("../intake-client").IntakeClient

function fakeItem(id: string) {
  return {
    id,
    createdAt: new Date().toISOString(),
    payload: { input: { title: id } as never, attachments: [] },
    attempts: 0,
    lastErrorAt: null,
    lastError: null,
  }
}

test("flush submits all items and removes on success", async () => {
  memory.clear()
  const q = createQueueStorage({ maxReports: 10, maxBytes: 1024 })
  await q.enqueue(fakeItem("a"))
  await q.enqueue(fakeItem("b"))
  const submitted: string[] = []
  const client: IntakeClient = {
    submit: async ({ idempotencyKey }) => {
      submitted.push(idempotencyKey)
      return { id: "server-" + idempotencyKey }
    },
  }
  const flusher = createQueueFlusher({ queue: q, client, backoffMs: [1, 2, 4, 8] })
  await flusher.flush()
  // oxlint-disable-next-line unicorn/no-array-sort
  expect([...submitted].sort()).toEqual(["a", "b"])
  expect(await q.all()).toEqual([])
})

test("flush increments attempts on retryable error and keeps the item", async () => {
  memory.clear()
  const q = createQueueStorage({ maxReports: 10, maxBytes: 1024 })
  await q.enqueue(fakeItem("x"))
  const client: IntakeClient = {
    submit: async () => {
      const err = new Error("500") as Error & { status?: number; retryable?: boolean }
      err.status = 503
      err.retryable = true
      throw err
    },
  }
  const flusher = createQueueFlusher({ queue: q, client, backoffMs: [1, 2, 4, 8] })
  await flusher.flush()
  const items = await q.all()
  expect(items).toHaveLength(1)
  expect(items[0]?.attempts).toBe(1)
  expect(items[0]?.lastError).toContain("500")
})

test("flush drops the item on non-retryable 4xx", async () => {
  memory.clear()
  const q = createQueueStorage({ maxReports: 10, maxBytes: 1024 })
  await q.enqueue(fakeItem("x"))
  const client: IntakeClient = {
    submit: async () => {
      const err = new Error("400") as Error & { status?: number; retryable?: boolean }
      err.status = 400
      err.retryable = false
      throw err
    },
  }
  const flusher = createQueueFlusher({ queue: q, client, backoffMs: [1, 2, 4, 8] })
  await flusher.flush()
  expect(await q.all()).toEqual([])
})

// `useRepro().queue.pending` / `.lastError` are public API. They were wired to
// a hardcoded `{ pending: 0, lastError: null }` stub in the provider, so a host
// app could never see that reports were failing. The flusher owns the real
// numbers.
test("status reports the pending count and the last error", async () => {
  memory.clear()
  const q = createQueueStorage({ maxReports: 10, maxBytes: 1024 })
  await q.enqueue(fakeItem("x"))
  const client: IntakeClient = {
    submit: async () => {
      const err = new Error("Invalid logs payload") as Error & {
        status?: number
        retryable?: boolean
      }
      err.status = 503
      err.retryable = true
      throw err
    },
  }
  const flusher = createQueueFlusher({ queue: q, client, backoffMs: [1, 2, 4, 8] })
  await flusher.flush()
  const status = flusher.status()
  expect(status.pending).toBe(1)
  expect(status.lastError).toContain("Invalid logs payload")
})

test("status clears lastError once the queue drains", async () => {
  memory.clear()
  const q = createQueueStorage({ maxReports: 10, maxBytes: 1024 })
  await q.enqueue(fakeItem("ok"))
  const client: IntakeClient = { submit: async () => ({ id: "server" }) }
  const flusher = createQueueFlusher({ queue: q, client, backoffMs: [1, 2, 4, 8] })
  await flusher.flush()
  const status = flusher.status()
  expect(status.pending).toBe(0)
  expect(status.lastError).toBeNull()
})

// A dropped report must not vanish without a trace.
test("onDrop fires when a report is discarded as non-retryable", async () => {
  memory.clear()
  const q = createQueueStorage({ maxReports: 10, maxBytes: 1024 })
  await q.enqueue(fakeItem("doomed"))
  const dropped: Array<{ id: string; status: number; message: string }> = []
  const client: IntakeClient = {
    submit: async () => {
      const err = new Error("Invalid logs payload") as Error & {
        status?: number
        retryable?: boolean
      }
      err.status = 400
      err.retryable = false
      throw err
    },
  }
  const flusher = createQueueFlusher({
    queue: q,
    client,
    backoffMs: [1, 2, 4, 8],
    onDrop: (info) => dropped.push(info),
  })
  await flusher.flush()
  expect(await q.all()).toEqual([])
  expect(dropped).toHaveLength(1)
  expect(dropped[0]?.id).toBe("doomed")
  expect(dropped[0]?.status).toBe(400)
})

// `backoffMs` was accepted and then never read — there was no retry timer at
// all. A retryable failure (5xx / 429 / offline) parked the report until the
// app was cold-started or backgrounded and re-foregrounded.
test("retries automatically on a backoff timer without an external trigger", async () => {
  memory.clear()
  const q = createQueueStorage({ maxReports: 10, maxBytes: 1024 })
  await q.enqueue(fakeItem("retry-me"))
  let calls = 0
  const client: IntakeClient = {
    submit: async () => {
      calls += 1
      if (calls === 1) {
        const err = new Error("503") as Error & { status?: number; retryable?: boolean }
        err.status = 503
        err.retryable = true
        throw err
      }
      return { id: "server" }
    },
  }
  const flusher = createQueueFlusher({ queue: q, client, backoffMs: [5, 10] })
  await flusher.flush()
  expect(await q.all()).toHaveLength(1)
  // No manual flush, no AppState change, no connectivity flip.
  await new Promise((r) => setTimeout(r, 80))
  expect(calls).toBe(2)
  expect(await q.all()).toEqual([])
  flusher.stop()
})

// `attempts` was incremented but never consulted, so a permanently-failing
// item retried forever.
test("drops the item once maxAttempts is exhausted and reports it", async () => {
  memory.clear()
  const q = createQueueStorage({ maxReports: 10, maxBytes: 1024 })
  await q.enqueue(fakeItem("doomed"))
  const dropped: Array<{ id: string; status: number }> = []
  const client: IntakeClient = {
    submit: async () => {
      const err = new Error("503") as Error & { status?: number; retryable?: boolean }
      err.status = 503
      err.retryable = true
      throw err
    },
  }
  const flusher = createQueueFlusher({
    queue: q,
    client,
    backoffMs: [1],
    maxAttempts: 2,
    onDrop: (info) => dropped.push(info),
  })
  await flusher.flush()
  await new Promise((r) => setTimeout(r, 60))
  expect(await q.all()).toEqual([])
  expect(dropped).toHaveLength(1)
  expect(dropped[0]?.id).toBe("doomed")
  flusher.stop()
})

test("stop() cancels a pending retry timer", async () => {
  memory.clear()
  const q = createQueueStorage({ maxReports: 10, maxBytes: 1024 })
  await q.enqueue(fakeItem("x"))
  let calls = 0
  const client: IntakeClient = {
    submit: async () => {
      calls += 1
      const err = new Error("503") as Error & { status?: number; retryable?: boolean }
      err.status = 503
      err.retryable = true
      throw err
    },
  }
  const flusher = createQueueFlusher({ queue: q, client, backoffMs: [5] })
  await flusher.flush()
  expect(calls).toBe(1)
  flusher.stop()
  await new Promise((r) => setTimeout(r, 60))
  expect(calls).toBe(1)
})

test("a fatal client error is dropped immediately, not retried", async () => {
  memory.clear()
  const q = createQueueStorage({ maxReports: 10, maxBytes: 1024 })
  await q.enqueue(fakeItem("fatal"))
  const dropped: Array<{ status: number }> = []
  const client: IntakeClient = {
    submit: async () => {
      throw Object.assign(new Error("intakeUrl did not return JSON"), {
        status: 0,
        retryable: false,
        fatal: true,
      })
    },
  }
  const flusher = createQueueFlusher({
    queue: q,
    client,
    backoffMs: [1, 2],
    maxAttempts: 10,
    onDrop: (info) => dropped.push({ status: info.status }),
  })
  await flusher.flush()
  expect(dropped).toHaveLength(1)
  expect(await q.all()).toEqual([])
  flusher.stop()
})

// Guards the offline queue: a network failure while offline throws with no
// status and no `fatal` flag. It must be retried, never discarded — otherwise
// the fatal-error fix would silently break offline reporting.
test("a plain network failure (offline) stays retryable", async () => {
  memory.clear()
  const q = createQueueStorage({ maxReports: 10, maxBytes: 1024 })
  await q.enqueue(fakeItem("offline"))
  const dropped: unknown[] = []
  const client: IntakeClient = {
    submit: async () => {
      throw new TypeError("Network request failed")
    },
  }
  const flusher = createQueueFlusher({
    queue: q,
    client,
    backoffMs: [1, 2],
    maxAttempts: 10,
    onDrop: (info) => dropped.push(info),
  })
  await flusher.flush()
  expect(dropped).toHaveLength(0)
  expect(await q.all()).toHaveLength(1)
  flusher.stop()
})
