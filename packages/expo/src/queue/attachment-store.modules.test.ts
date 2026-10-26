import { expect, test } from "bun:test"
import {
  createAttachmentStore,
  loadAttachmentFs,
  type ExpoFileSystemModule,
} from "./attachment-store"

// `loadAttachmentFs` is handed fakes shaped like what `import("expo-file-system")`
// resolves to on each Expo SDK generation. The fakes are partial, so each one
// is widened through `unknown`; the function only touches the members under test.

const SHOT = "file:///tmp/ReactNative/shot.png"
const COPY = "file:///data/documents/repro-queue/r1/0-shot.png"
const DIR = "file:///data/documents/repro-queue/r1/"

// SDK >= 54 keeps the legacy names on the main entry as stubs that throw.
const legacyStub = (name: string) => async () => {
  throw new Error(`Method ${name} imported from "expo-file-system" is deprecated.`)
}

function sdk54Module(calls: string[]): ExpoFileSystemModule {
  class Directory {
    uri: string
    exists = false
    constructor(...uris: string[]) {
      this.uri = uris.join("")
    }
    create() {
      calls.push(`Directory.create ${this.uri}`)
    }
    delete() {
      calls.push(`Directory.delete ${this.uri}`)
    }
  }
  class File {
    uri: string
    exists = true
    size = 42
    constructor(...uris: string[]) {
      this.uri = uris.join("")
    }
    copy(destination: File | Directory) {
      calls.push(`File.copy ${this.uri} -> ${destination.uri}`)
    }
  }
  return {
    File,
    Directory,
    // Real SDK 54 returns the document directory without a trailing slash.
    Paths: { document: new Directory("file:///data/documents"), cache: new Directory("x") },
    copyAsync: legacyStub("copyAsync"),
    makeDirectoryAsync: legacyStub("makeDirectoryAsync"),
    deleteAsync: legacyStub("deleteAsync"),
    getInfoAsync: legacyStub("getInfoAsync"),
  } as unknown as ExpoFileSystemModule
}

function sdk52Module(calls: string[]): ExpoFileSystemModule {
  return {
    documentDirectory: "file:///data/documents/",
    makeDirectoryAsync: async (uri: string, options?: { intermediates?: boolean }) => {
      calls.push(`makeDirectoryAsync ${uri} intermediates=${options?.intermediates}`)
    },
    copyAsync: async ({ from, to }: { from: string; to: string }) => {
      calls.push(`copyAsync ${from} -> ${to}`)
    },
    deleteAsync: async (uri: string, options?: { idempotent?: boolean }) => {
      calls.push(`deleteAsync ${uri} idempotent=${options?.idempotent}`)
    },
    getInfoAsync: async (uri: string) => {
      calls.push(`getInfoAsync ${uri}`)
      return { exists: true, size: 42 }
    },
  } as unknown as ExpoFileSystemModule
}

test("SDK 54 shape: persists through File/Directory and never calls the throwing legacy stubs", async () => {
  const calls: string[] = []
  const fs = await loadAttachmentFs(async () => sdk54Module(calls))
  expect(fs).not.toBeNull()

  const store = createAttachmentStore(fs)
  const out = await store.persist("r1", [{ kind: "screenshot", uri: SHOT, bytes: 0 }])

  expect(out).toEqual([{ kind: "screenshot", uri: COPY, bytes: 42 }])
  expect(calls).toEqual([`Directory.create ${DIR}`, `File.copy ${SHOT} -> ${COPY}`])

  calls.length = 0
  await store.discard("r1")
  // The directory reports exists=false, so discard must not attempt a delete.
  expect(calls).toEqual([])
})

test("SDK 52 shape: persists through the legacy *Async functions", async () => {
  const calls: string[] = []
  const fs = await loadAttachmentFs(async () => sdk52Module(calls))
  expect(fs).not.toBeNull()

  const store = createAttachmentStore(fs)
  const out = await store.persist("r1", [{ kind: "screenshot", uri: SHOT, bytes: 0 }])

  expect(out).toEqual([{ kind: "screenshot", uri: COPY, bytes: 42 }])
  expect(calls).toEqual([
    `makeDirectoryAsync ${DIR} intermediates=true`,
    `copyAsync ${SHOT} -> ${COPY}`,
    `getInfoAsync ${COPY}`,
  ])

  calls.length = 0
  await store.discard("r1")
  expect(calls).toEqual([`deleteAsync ${DIR} idempotent=true`])
})

test("a module that cannot be imported yields no file system", async () => {
  const fs = await loadAttachmentFs(async () => {
    throw new Error("Unable to resolve module expo-file-system")
  })
  expect(fs).toBeNull()
})
