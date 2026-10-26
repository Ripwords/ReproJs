// Capture a single frame via the browser's Screen Capture API. Far more
// reliable than DOM-cloning libraries on real apps:
//  - The browser produces the actual rendered pixels, so shadow DOM, web
//    components (Next.js dev overlay, Vercel toolbar, etc.), custom fonts,
//    blend modes, and CSS edge cases all just work.
//  - Capture is bounded by user interaction (the "Share this tab?" prompt)
//    and a single ImageCapture/canvas grab; no resource inlining loop that
//    can stall on slow CDN font fetches.
//
// Tradeoff: the browser shows a permission prompt. Browsers that don't
// expose the API at all (every iOS browser, most Android ones) fall through
// to the DOM path; a user who declines gets a toast and stays in the widget.

/** True when this browser exposes the Screen Capture API at all. */
export function isDisplayMediaSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.getDisplayMedia === "function"
  )
}

interface ChromiumDisplayMediaConstraints extends DisplayMediaStreamOptions {
  // Chromium-only hints; ignored elsewhere. preferCurrentTab makes the
  // picker collapse to a one-click "Share this tab" affordance instead of
  // the full source picker.
  preferCurrentTab?: boolean
  selfBrowserSurface?: "include" | "exclude"
  surfaceSwitching?: "include" | "exclude"
  systemAudio?: "include" | "exclude"
  monitorTypeSurfaces?: "include" | "exclude"
}

export async function captureViaDisplayMedia(): Promise<Blob | null> {
  if (!isDisplayMediaSupported()) return null
  let stream: MediaStream | null = null
  try {
    const constraints: ChromiumDisplayMediaConstraints = {
      video: { displaySurface: "browser" },
      audio: false,
      preferCurrentTab: true,
      selfBrowserSurface: "include",
      surfaceSwitching: "exclude",
      systemAudio: "exclude",
      monitorTypeSurfaces: "exclude",
    }
    stream = await navigator.mediaDevices.getDisplayMedia(constraints as DisplayMediaStreamOptions)
    const track = stream.getVideoTracks()[0]
    if (!track) return null
    // Between the user clicking "Share" and grabFrame running there is a
    // race against the tab-capture compositor: the MediaStream goes active
    // instantly, but the first frame it produces can land before pending
    // image layers have been uploaded to the GPU. grabFrame returns
    // whatever is buffered, so an early grab shows broken-image glyphs on
    // assets that are fine on the live page. Force any pending <img>
    // decodes first, then wait one frame for the compositor to produce a
    // clean frame before grabbing.
    await primePendingImageDecodes()
    await nextAnimationFrame()
    return await grabFrame(track, stream)
  } catch {
    // Most common path: NotAllowedError (user denied) or NotSupportedError.
    // Stay quiet — caller falls back to DOM capture.
    return null
  } finally {
    stream?.getTracks().forEach((t) => t.stop())
  }
}

// `ImageCapture` lives in lib.dom.d.ts only behind the WICG types, which
// some TS configs don't include. Declare a minimal local shape so the
// feature-detection branch type-checks without an `as unknown as` cast.
// Read it off `globalThis` (not `window`) so the test environment can stub
// it: in happy-dom these aren't the same object.
interface ImageCaptureCtor {
  new (track: MediaStreamTrack): { grabFrame(): Promise<ImageBitmap> }
}

declare global {
  // eslint-disable-next-line vars-on-top, no-var
  var ImageCapture: ImageCaptureCtor | undefined
}

async function grabFrame(track: MediaStreamTrack, stream: MediaStream): Promise<Blob | null> {
  const Ctor = globalThis.ImageCapture
  if (Ctor) {
    const bitmap = await new Ctor(track).grabFrame()
    return await bitmapToBlob(bitmap)
  }
  // Safari and older Firefox don't expose ImageCapture. Fall back to a
  // hidden <video> + canvas draw on the next frame.
  return await videoFrameToBlob(stream)
}

async function bitmapToBlob(bitmap: ImageBitmap): Promise<Blob | null> {
  const canvas = document.createElement("canvas")
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const ctx = canvas.getContext("2d")
  if (!ctx) return null
  ctx.drawImage(bitmap, 0, 0)
  const blob = await canvasToBlob(canvas)
  // Free the bitmap explicitly when supported — large frames otherwise sit
  // in GPU memory until GC runs.
  if (typeof (bitmap as ImageBitmap & { close?: () => void }).close === "function") {
    ;(bitmap as ImageBitmap & { close: () => void }).close()
  }
  return blob
}

async function videoFrameToBlob(stream: MediaStream): Promise<Blob | null> {
  const video = document.createElement("video")
  video.srcObject = stream
  video.muted = true
  try {
    await video.play().catch(() => {})
    // videoWidth/Height are populated at `loadedmetadata` (readyState >= 1),
    // not `loadeddata` (>= 2). Gating on the latter on Safari can leave us
    // drawing onto a 0×0 canvas. Also race against a 5s timeout so a stuck
    // metadata event can't hang the whole capture.
    await new Promise<void>((resolve, reject) => {
      if (video.readyState >= 1 && video.videoWidth > 0) {
        resolve()
        return
      }
      const onMeta = () => {
        cleanup()
        resolve()
      }
      const onErr = () => {
        cleanup()
        reject(new Error("video metadata never loaded"))
      }
      const timer = setTimeout(onErr, 5_000)
      const cleanup = () => {
        clearTimeout(timer)
        video.removeEventListener("loadedmetadata", onMeta)
        video.removeEventListener("error", onErr)
      }
      video.addEventListener("loadedmetadata", onMeta, { once: true })
      video.addEventListener("error", onErr, { once: true })
    })
    if (video.videoWidth === 0 || video.videoHeight === 0) return null
    const canvas = document.createElement("canvas")
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext("2d")
    if (!ctx) return null
    ctx.drawImage(video, 0, 0)
    return await canvasToBlob(canvas)
  } finally {
    // Drop the strong stream reference so GC can reclaim the <video> and
    // its decoded frames promptly — the caller stops the tracks separately.
    video.srcObject = null
  }
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b), "image/png")
  })
}

async function primePendingImageDecodes(): Promise<void> {
  if (typeof document === "undefined") return
  // Use getElementsByTagName rather than document.images — the latter is
  // a convenience collection that some DOM test doubles (e.g. happy-dom)
  // do not implement.
  const imgs = Array.from(document.getElementsByTagName("img")) as HTMLImageElement[]
  // Important: only prime images that are ALREADY fully loaded. Calling
  // `img.decode()` on an <img> with no src — or one whose src is still
  // in-flight — returns a promise that may NEVER resolve per the HTML
  // spec. Real pages contain many such elements (React skeletons, lazy-
  // loaded images below the fold, placeholder nodes). Awaiting them would
  // block the whole capture, which means the MediaStream stays active and
  // Chrome's "<URL> is sharing your screen" indicator hangs until the user
  // manually stops it.
  const ready = imgs.filter((img) => img.complete && img.naturalWidth > 0)
  if (ready.length === 0) return
  // Even for ready images, decode() should be fast — but we race against a
  // short timeout so a pathological decode (cross-origin taint, corrupted
  // bitmap) can't strand the capture. 300ms is generous; real decodes
  // resolve in well under 10ms.
  const decodes = Promise.all(
    ready.map((img) =>
      typeof img.decode === "function" ? img.decode().catch(() => {}) : Promise.resolve(),
    ),
  )
  const timeout = new Promise((resolve) => setTimeout(resolve, 300))
  await Promise.race([decodes, timeout])
}

function nextAnimationFrame(): Promise<void> {
  // Route through globalThis so tests can stub this (and so `this`-binding
  // on the hosting browser's rAF stays correct — some DOM implementations
  // require the call site to be `window.requestAnimationFrame`).
  const raf = (globalThis as { requestAnimationFrame?: (cb: FrameRequestCallback) => number })
    .requestAnimationFrame
  if (typeof raf !== "function") return Promise.resolve()
  return new Promise((resolve) => {
    raf.call(globalThis, () => resolve())
  })
}
