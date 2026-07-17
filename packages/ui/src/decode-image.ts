// Turning a captured Blob into something drawable must not depend on the host
// page's Content-Security-Policy.
//
// The obvious route — URL.createObjectURL(blob) assigned to an <img> — is a
// resource load, so it is checked against `img-src`. Real host pages routinely
// ship `img-src 'self' data:` with no `blob:` (Pantheon/WordPress defaults,
// most CSP generators). There the load is refused, `error` fires instead of
// `load`, and the reporter is left with no screenshot.
//
// createImageBitmap decodes the Blob in-process with no fetch, so `img-src`
// never applies. It is the primary path; the <img> route survives only as a
// fallback for engines without it, and always resolves (null on failure)
// rather than hanging.

export type ImageSource = ImageBitmap | HTMLImageElement

// How long the <img> fallback waits before giving up. Only reachable on
// engines without createImageBitmap; a refused load normally fires `error`
// immediately, but a policy that neither loads nor errors must not strand the
// caller.
const FALLBACK_TIMEOUT_MS = 10_000

export function sourceWidth(src: ImageSource): number {
  return "naturalWidth" in src ? src.naturalWidth : src.width
}

export function sourceHeight(src: ImageSource): number {
  return "naturalHeight" in src ? src.naturalHeight : src.height
}

// Release an ImageBitmap's backing memory. Large frames otherwise sit in GPU
// memory until GC runs. No-op for <img>.
export function closeSource(src: ImageSource | null): void {
  if (src && "close" in src && typeof src.close === "function") src.close()
}

export async function decodeImage(blob: Blob): Promise<ImageSource | null> {
  const create = (
    globalThis as {
      createImageBitmap?: (b: Blob) => Promise<ImageBitmap>
    }
  ).createImageBitmap
  if (typeof create === "function") {
    try {
      return await create.call(globalThis, blob)
    } catch {
      // Corrupt/undecodable data, or an engine that rejects this blob type.
      // Try the <img> route before giving up.
    }
  }
  return await decodeViaObjectUrl(blob)
}

async function decodeViaObjectUrl(blob: Blob): Promise<HTMLImageElement | null> {
  let created: string
  try {
    created = URL.createObjectURL(blob)
  } catch {
    return null
  }
  const img = new Image()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    // `once` listeners are mutually exclusive, and the timeout only decides the
    // race — whichever settles first wins and the rest are inert.
    const loaded = await Promise.race([
      new Promise<boolean>((resolve) => {
        img.addEventListener("load", () => resolve(true), { once: true })
        img.addEventListener("error", () => resolve(false), { once: true })
        img.src = created
      }),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), FALLBACK_TIMEOUT_MS)
      }),
    ])
    return loaded ? img : null
  } finally {
    clearTimeout(timer)
    URL.revokeObjectURL(created)
  }
}
