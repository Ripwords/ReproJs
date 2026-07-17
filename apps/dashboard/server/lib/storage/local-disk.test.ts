import { describe, expect, test, beforeEach, afterAll } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { LocalDiskAdapter } from "./local-disk"

async function collect(stream: NodeJS.ReadableStream): Promise<Uint8Array> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return new Uint8Array(Buffer.concat(chunks))
}

let root: string
const roots: string[] = []

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "ft-storage-"))
  roots.push(root)
})

afterAll(async () => {
  await Promise.all(roots.map((r) => rm(r, { recursive: true, force: true })))
})

describe("LocalDiskAdapter", () => {
  test("put writes bytes and returns the key", async () => {
    const adapter = new LocalDiskAdapter(root)
    const key = "attachments/abc/screenshot.png"
    const bytes = new Uint8Array([137, 80, 78, 71])
    const result = await adapter.put(key, bytes, "image/png")
    expect(result.key).toBe(key)
  })

  test("get returns the bytes and content-type written by put", async () => {
    const adapter = new LocalDiskAdapter(root)
    const key = "attachments/xyz/foo.png"
    const bytes = new Uint8Array([1, 2, 3, 4, 5])
    await adapter.put(key, bytes, "image/png")
    const got = await adapter.get(key)
    expect(Array.from(got.bytes)).toEqual([1, 2, 3, 4, 5])
    expect(got.contentType).toBe("image/png")
  })

  test("put creates parent directories", async () => {
    const adapter = new LocalDiskAdapter(root)
    await adapter.put("a/deeply/nested/key.bin", new Uint8Array([9]), "application/octet-stream")
    const got = await adapter.get("a/deeply/nested/key.bin")
    expect(got.bytes.length).toBe(1)
  })

  test("delete removes the file; deleting missing is not an error", async () => {
    const adapter = new LocalDiskAdapter(root)
    await adapter.put("x.bin", new Uint8Array([1]), "application/octet-stream")
    await adapter.delete("x.bin")
    await expect(adapter.get("x.bin")).rejects.toThrow()
    await adapter.delete("x.bin") // second delete no-op
  })

  test("getStream with a range returns exactly the requested bytes", async () => {
    const adapter = new LocalDiskAdapter(root)
    const key = "attachments/range/ten.bin"
    const bytes = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    await adapter.put(key, bytes, "application/octet-stream")

    const result = await adapter.getStream(key, { start: 2, end: 5 })
    const got = await collect(result.stream as NodeJS.ReadableStream)

    expect(Array.from(got)).toEqual([2, 3, 4, 5])
    expect(result.totalBytes).toBe(10)
    expect(result.start).toBe(2)
    expect(result.end).toBe(5)
    expect(result.contentType).toBe("application/octet-stream")
  })

  test("getStream with no range returns the full object", async () => {
    const adapter = new LocalDiskAdapter(root)
    const key = "attachments/range/full.bin"
    const bytes = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    await adapter.put(key, bytes, "application/octet-stream")

    const result = await adapter.getStream(key)
    const got = await collect(result.stream as NodeJS.ReadableStream)

    expect(Array.from(got)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(result.totalBytes).toBe(10)
    expect(result.start).toBe(0)
    expect(result.end).toBe(9)
  })

  test("getStream on a missing key rejects", async () => {
    const adapter = new LocalDiskAdapter(root)
    await expect(adapter.getStream("nope.bin")).rejects.toThrow()
  })
})
