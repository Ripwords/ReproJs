import type { QueueItemAttachment } from "./storage"

/**
 * The slice of a file system the queue needs. Kept tiny and injectable so the
 * store is testable without a device, and so both expo-file-system APIs (the
 * legacy module in SDK <= 53 and the class-based one in SDK >= 54) can back it.
 * Every uri/path is a `file://` string.
 */
export interface AttachmentFs {
  /** Per-app persistent directory, trailing slash included. */
  documentDirectory: string
  /** Create the directory and any missing parents; a no-op when it exists. */
  makeDirectory: (dir: string) => Promise<void>
  copy: (from: string, to: string) => Promise<void>
  /** Delete a file or directory recursively; a no-op when it does not exist. */
  remove: (path: string) => Promise<void>
  /** Byte size of a file, or null when it cannot be determined. */
  size: (uri: string) => Promise<number | null>
}

export interface AttachmentStore {
  /**
   * Copy each attachment into a directory the SDK owns and return the list
   * with uris pointing at the copies. Screenshots come from
   * react-native-view-shot's `tmpfile` and picked files live in the cache
   * directory; iOS purges `tmp/` and rotates the container path on app
   * update, Android clears the cache under pressure. A queued report that
   * still points there is lost on the next restart.
   */
  persist: (reportId: string, attachments: QueueItemAttachment[]) => Promise<QueueItemAttachment[]>
  /** Delete the copies made for `reportId`. Never throws. */
  discard: (reportId: string) => Promise<void>
}

const QUEUE_DIR = "repro-queue/"

function basename(uri: string): string {
  const tail = uri.split("?")[0]?.split("/").pop() ?? ""
  // Keep the extension, drop anything the file system might object to.
  const safe = tail.replace(/[^\w.-]+/g, "_")
  return safe.length > 0 ? safe : "attachment"
}

export function createAttachmentStore(fs: AttachmentFs | null): AttachmentStore {
  function reportDir(reportId: string): string {
    return `${fs?.documentDirectory ?? ""}${QUEUE_DIR}${reportId}/`
  }

  return {
    async persist(reportId, attachments) {
      if (!fs || attachments.length === 0) return attachments
      const dir = reportDir(reportId)
      try {
        await fs.makeDirectory(dir)
      } catch (err) {
        console.warn(
          `[repro] could not create ${dir}; queued attachments will stay in their original location`,
          err,
        )
        return attachments
      }
      const out: QueueItemAttachment[] = []
      let index = 0
      for (const a of attachments) {
        // Index prefix: two camera-roll photos routinely share a filename.
        const target = `${dir}${index}-${basename(a.filename ?? a.uri)}`
        index += 1
        let uri = a.uri
        try {
          // eslint-disable-next-line no-await-in-loop -- copies are sequential on purpose; parallel file I/O on a phone buys nothing and complicates partial-failure handling
          await fs.copy(a.uri, target)
          uri = target
        } catch (err) {
          console.warn(
            `[repro] could not copy attachment ${a.filename ?? a.uri} into the queue; keeping the original uri`,
            err,
          )
        }
        let bytes = a.bytes
        if (bytes <= 0) {
          // eslint-disable-next-line no-await-in-loop
          const measured = await fs.size(uri).catch(() => null)
          if (measured !== null) bytes = measured
        }
        out.push({ ...a, uri, bytes })
      }
      return out
    },
    async discard(reportId) {
      if (!fs) return
      try {
        await fs.remove(reportDir(reportId))
      } catch (err) {
        console.warn(`[repro] could not delete queued attachments for report ${reportId}`, err)
      }
    },
  }
}

/**
 * Resolve `expo-file-system` to an {@link AttachmentFs}, or null when the
 * module is not installed. Handles both API generations: SDK <= 53 exports
 * `documentDirectory` + `*Async` functions; SDK >= 54 exports `Paths`,
 * `File` and `Directory` classes from the same entry point.
 *
 * The class API is probed first on purpose. SDK >= 54 still exports
 * `copyAsync`, `makeDirectoryAsync` and friends from the main entry, but as
 * stubs that `console.warn` and throw ("import from expo-file-system/legacy").
 * Their presence says nothing about whether they work, so a legacy-first probe
 * would pick a file system that fails on every call.
 */
export type ExpoFileSystemModule = typeof import("expo-file-system")

export async function loadAttachmentFs(
  /** Injectable for tests, which hand in a module shaped like one SDK generation. */
  load: () => Promise<ExpoFileSystemModule> = () => import("expo-file-system"),
): Promise<AttachmentFs | null> {
  let mod: ExpoFileSystemModule
  try {
    mod = await load()
  } catch {
    return null
  }

  if (mod.File && mod.Directory && mod.Paths?.document) {
    const { File, Directory, Paths } = mod
    const root = Paths.document.uri.endsWith("/") ? Paths.document.uri : `${Paths.document.uri}/`
    return {
      documentDirectory: root,
      makeDirectory: async (dir) => {
        new Directory(dir).create({ intermediates: true, idempotent: true })
      },
      copy: async (from, to) => {
        new File(from).copy(new File(to))
      },
      remove: async (path) => {
        const dir = new Directory(path)
        if (dir.exists) dir.delete()
      },
      size: async (uri) => {
        const file = new File(uri)
        return file.exists ? file.size : null
      },
    }
  }

  const documentDirectory = mod.documentDirectory
  if (typeof mod.copyAsync === "function" && typeof documentDirectory === "string") {
    const legacy = mod
    return {
      documentDirectory,
      makeDirectory: (dir) => legacy.makeDirectoryAsync(dir, { intermediates: true }),
      copy: (from, to) => legacy.copyAsync({ from, to }),
      remove: (path) => legacy.deleteAsync(path, { idempotent: true }),
      size: async (uri) => {
        const info = await legacy.getInfoAsync(uri, { size: true })
        return info.exists && typeof info.size === "number" ? info.size : null
      },
    }
  }

  return null
}
