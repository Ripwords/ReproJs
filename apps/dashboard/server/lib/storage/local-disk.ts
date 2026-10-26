import { randomUUID } from "node:crypto"
import { createReadStream } from "node:fs"
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import type { StorageAdapter, StorageStream } from "./index"

const CONTENT_TYPE_SUFFIX = ".contenttype"
const TMP_SUFFIX = ".tmp"

/** Write to a sibling temp file and rename over the target (atomic on POSIX). */
async function writeAtomic(path: string, data: Uint8Array | string): Promise<void> {
  const tmp = `${path}.${randomUUID()}${TMP_SUFFIX}`
  try {
    await writeFile(tmp, data)
    await rename(tmp, path)
  } catch (err) {
    await unlink(tmp).catch(() => undefined)
    throw err
  }
}

export class LocalDiskAdapter implements StorageAdapter {
  private readonly root: string

  constructor(root: string) {
    this.root = resolve(root)
  }

  async put(key: string, bytes: Uint8Array, contentType: string) {
    const full = this.resolveKey(key)
    await mkdir(dirname(full), { recursive: true })
    // Write-then-rename so a crash or a concurrent reader mid-write can never
    // observe a truncated blob or sidecar under the final name.
    await Promise.all([
      writeAtomic(full, bytes),
      writeAtomic(`${full}${CONTENT_TYPE_SUFFIX}`, contentType),
    ])
    return { key }
  }

  async get(key: string) {
    const full = this.resolveKey(key)
    const bytes = await readFile(full)
    let contentType = "application/octet-stream"
    try {
      contentType = (await readFile(`${full}${CONTENT_TYPE_SUFFIX}`, "utf8")).trim()
    } catch {
      // sidecar missing — fall through
    }
    return { bytes: new Uint8Array(bytes), contentType }
  }

  async getStream(key: string, range?: { start: number; end?: number }): Promise<StorageStream> {
    const full = this.resolveKey(key)
    const st = await stat(full)
    let contentType = "application/octet-stream"
    try {
      contentType = (await readFile(`${full}${CONTENT_TYPE_SUFFIX}`, "utf8")).trim()
    } catch {
      // sidecar missing — fall through
    }
    const start = range?.start ?? 0
    const end = range?.end ?? st.size - 1
    const stream = createReadStream(full, { start, end })
    return { stream, contentType, totalBytes: st.size, start, end }
  }

  async delete(key: string) {
    const full = this.resolveKey(key)
    await Promise.all(
      [full, `${full}${CONTENT_TYPE_SUFFIX}`].map((p) => unlink(p).catch(() => undefined)),
    )
  }

  private resolveKey(key: string): string {
    const joined = resolve(join(this.root, key))
    if (!joined.startsWith(this.root)) {
      throw new Error(`storage: key "${key}" escapes root`)
    }
    return joined
  }
}
