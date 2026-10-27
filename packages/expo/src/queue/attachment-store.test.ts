import { test, expect } from "bun:test"
import { createAttachmentStore, type AttachmentFs } from "./attachment-store"
import type { QueueItemAttachment } from "./storage"

// In-memory stand-in for expo-file-system: a flat map of path -> bytes plus a
// set of directories, so the tests can assert on what actually ended up where.
function memoryFs(seed: Record<string, number>) {
  const files = new Map<string, number>(Object.entries(seed))
  const dirs = new Set<string>()
  const fs: AttachmentFs = {
    documentDirectory: "file:///data/Documents/",
    async makeDirectory(path) {
      dirs.add(path)
    },
    async copy(from, to) {
      const size = files.get(from)
      if (size === undefined) throw new Error(`ENOENT ${from}`)
      files.set(to, size)
    },
    async remove(path) {
      dirs.delete(path)
      for (const key of files.keys()) {
        if (key.startsWith(path)) files.delete(key)
      }
    },
    async size(uri) {
      return files.get(uri) ?? null
    },
    async exists(uri) {
      return files.has(uri)
    },
  }
  return { fs, files, dirs }
}

const screenshot: QueueItemAttachment = {
  kind: "screenshot",
  uri: "file:///tmp/ReactNative/shot.png",
  bytes: 0,
}
const pickedPdf: QueueItemAttachment = {
  kind: "user-file",
  uri: "file:///cache/DocumentPicker/report.pdf",
  bytes: 2048,
  filename: "report.pdf",
  contentType: "application/pdf",
}

// iOS purges tmp/ and rotates the container UUID on update; Android clears
// the cache dir. A queued report must not point at either location.
test("persist copies every attachment under documentDirectory/repro-queue/<id>/", async () => {
  const { fs, files } = memoryFs({ [screenshot.uri]: 500, [pickedPdf.uri]: 2048 })
  const store = createAttachmentStore(fs)
  const out = await store.persist("r1", [screenshot, pickedPdf])
  expect(out).toHaveLength(2)
  for (const a of out) {
    expect(a.uri.startsWith("file:///data/Documents/repro-queue/r1/")).toBe(true)
    expect(files.has(a.uri)).toBe(true)
  }
  // Kind, filename and content type travel with the new uri.
  expect(out[1]?.filename).toBe("report.pdf")
  expect(out[1]?.contentType).toBe("application/pdf")
  expect(out[1]?.kind).toBe("user-file")
})

// The provider enqueued screenshots with `bytes: 0`, so the queue's maxBytes
// cap never saw them.
test("persist records the real byte size when the caller did not know it", async () => {
  const { fs } = memoryFs({ [screenshot.uri]: 73_421, [pickedPdf.uri]: 2048 })
  const store = createAttachmentStore(fs)
  const out = await store.persist("r1", [screenshot, pickedPdf])
  expect(out[0]?.bytes).toBe(73_421)
  // A size the picker already reported is kept as-is.
  expect(out[1]?.bytes).toBe(2048)
})

test("two attachments with the same filename do not overwrite each other", async () => {
  const a = {
    ...pickedPdf,
    uri: "file:///cache/a/IMG_0001.jpg",
    filename: "IMG_0001.jpg",
    bytes: 0,
  }
  const b = {
    ...pickedPdf,
    uri: "file:///cache/b/IMG_0001.jpg",
    filename: "IMG_0001.jpg",
    bytes: 0,
  }
  const { fs } = memoryFs({ [a.uri]: 10, [b.uri]: 20 })
  const store = createAttachmentStore(fs)
  const out = await store.persist("r1", [a, b])
  expect(out[0]?.uri).not.toBe(out[1]?.uri)
  expect(out[0]?.bytes).toBe(10)
  expect(out[1]?.bytes).toBe(20)
})

// A copy failure must not take the whole report down: keep the original uri
// (it may still be readable at flush time) and let the intake client decide.
test("a failed copy keeps the original uri instead of throwing", async () => {
  const { fs } = memoryFs({ [pickedPdf.uri]: 2048 }) // screenshot source missing
  const store = createAttachmentStore(fs)
  const warnings: unknown[][] = []
  const originalWarn = console.warn
  console.warn = (...args: unknown[]) => {
    warnings.push(args)
  }
  try {
    const out = await store.persist("r1", [screenshot, pickedPdf])
    expect(out[0]?.uri).toBe(screenshot.uri)
    expect(out[1]?.uri.startsWith("file:///data/Documents/repro-queue/r1/")).toBe(true)
    expect(warnings.length).toBe(1)
  } finally {
    console.warn = originalWarn
  }
})

test("without a file system the attachments pass through unchanged", async () => {
  const store = createAttachmentStore(null)
  const out = await store.persist("r1", [screenshot, pickedPdf])
  expect(out).toEqual([screenshot, pickedPdf])
})

test("discard removes the report's directory and is safe to repeat", async () => {
  const { fs, files, dirs } = memoryFs({ [screenshot.uri]: 500 })
  const store = createAttachmentStore(fs)
  const out = await store.persist("r1", [screenshot])
  expect(files.has(out[0]?.uri ?? "")).toBe(true)
  await store.discard("r1")
  expect(files.has(out[0]?.uri ?? "")).toBe(false)
  expect([...dirs].some((d) => d.includes("/r1"))).toBe(false)
  // Second discard and an unknown id are no-ops, not errors.
  await store.discard("r1")
  await store.discard("never-existed")
})

test("discard swallows file-system errors so a flush is never blocked by cleanup", async () => {
  const { fs } = memoryFs({})
  fs.remove = async () => {
    throw new Error("EBUSY")
  }
  const store = createAttachmentStore(fs)
  await expect(store.discard("r1")).resolves.toBeUndefined()
})
