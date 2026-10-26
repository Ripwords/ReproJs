import { domToBlob } from "modern-screenshot"
import { captureViaDisplayMedia, isDisplayMediaSupported } from "./display-media"
import { createOverlayPinner } from "./pin-overlays"

const HOST_ID = "repro-host"

// Built-in exclusions for elements that are known to stall modern-screenshot
// when it recurses into their shadow roots. The Next.js dev overlay
// (<nextjs-portal>) attaches an open shadow root containing the full dev
// panel tree (CSS-in-JS, custom fonts, deeply nested SVGs); on real apps
// this never finishes inlining and "Capturing…" hangs forever.
const DEFAULT_EXCLUDED_TAGS = new Set(["NEXTJS-PORTAL"])

export type CaptureMethod = "auto" | "display-media" | "dom"

export interface CaptureOptions {
  // Which capture path to use. Defaults to "auto":
  //   "auto" — use the browser's getDisplayMedia when the API exists
  //     (pixel-perfect, ~50ms after the user accepts the "Share this tab?"
  //     prompt, no DOM cloning, no font inlining, no shadow-DOM traps).
  //     When the API is missing entirely (every iOS browser, most Android
  //     ones) fall back to the DOM path — otherwise mobile users could never
  //     capture at all. When the user declines the prompt, return null and
  //     do NOT fall back: the DOM path can stall indefinitely on heavy
  //     desktop pages (CSS-in-JS, web components, slow CDN fonts), and the
  //     widget shows a toast so the user can retry or continue without one.
  //   "display-media" — require getDisplayMedia; null if missing or denied.
  //   "dom" — skip the permission prompt entirely and use modern-screenshot.
  //     Opt-in only, for hosts that don't want the browser prompt.
  method?: CaptureMethod
  // Extra selectors to skip during the DOM-path snapshot. Useful for
  // third-party widgets that stall modern-screenshot (Vercel toolbar,
  // Intercom, Storybook addons, etc.). Has no effect on the display-media
  // path — that one captures real pixels and doesn't need exclusions.
  excludeSelectors?: string[]
}

function buildFilter(opts: CaptureOptions): (node: Node) => boolean {
  const selectors = opts.excludeSelectors ?? []
  const matchSelector = selectors.length > 0 ? selectors.join(",") : null
  return (node: Node) => {
    if (node.nodeType !== 1) return true
    const el = node as Element
    if (el.id === HOST_ID) return false
    if (DEFAULT_EXCLUDED_TAGS.has(el.tagName)) return false
    if (matchSelector && typeof el.matches === "function" && el.matches(matchSelector)) {
      return false
    }
    return true
  }
}

// The display-media path captures the real screen, so the widget host
// would otherwise appear in the frame. Hide it across the await — safe
// here because the await is bounded by the user clicking "Share" on the
// browser-native prompt (seconds), not by a 30s library work loop.
async function withHiddenHost<T>(work: () => Promise<T>): Promise<T> {
  const host = document.getElementById(HOST_ID) as HTMLElement | null
  const prev = host?.style.display ?? ""
  if (host) host.style.display = "none"
  try {
    return await work()
  } finally {
    if (host) host.style.display = prev
  }
}

// Safari refuses canvases above ~16.7 million pixels (toBlob returns null),
// and other engines get very slow well before that. A 4K viewport at 2× DPR
// is ~33 MP, so cap the backing-store pixel count and lower the scale to fit.
const MAX_CANVAS_PIXELS = 16_000_000

export function domCaptureScale(width: number, height: number, dpr: number): number {
  const area = Math.max(1, width) * Math.max(1, height)
  const maxScale = Math.sqrt(MAX_CANVAS_PIXELS / area)
  return Math.max(0.1, Math.min(dpr || 1, maxScale))
}

async function captureViaDom(opts: CaptureOptions): Promise<Blob | null> {
  const root = document.documentElement
  const pinner = createOverlayPinner(root, buildFilter(opts))
  try {
    return await domToBlob(root, {
      scale: domCaptureScale(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1),
      width: window.innerWidth,
      height: window.innerHeight,
      // Opt-in in modern-screenshot (every other feature defaults on). Without
      // it the clone renders from scroll offset zero, so a scrolled page — or a
      // scrolled sidebar/table/list inside it — captures its top, not what the
      // reporter was looking at.
      // Those shifts drag fixed and sticky elements out of frame too; the
      // pinner puts them back where they are on screen.
      features: { restoreScrollPosition: true },
      filter: pinner.filter,
      onCloneEachNode: pinner.onCloneEachNode,
      onCloneNode: pinner.onCloneNode,
    })
  } catch (err) {
    console.warn("[repro] screenshot capture failed:", err)
    return null
  }
}

export async function capture(opts: CaptureOptions = {}): Promise<Blob | null> {
  const method = opts.method ?? "auto"
  if (method === "dom") {
    return await captureViaDom(opts)
  }
  // No Screen Capture API at all (mobile browsers): "auto" takes the DOM
  // path, since there is no prompt the user could have accepted. Only the
  // API-missing case falls back — a *declined* prompt still returns null so
  // a heavy desktop page can't strand the user on "Capturing…" (the DOM
  // path stalls on Next.js dev overlays, CSS-in-JS, slow-inlining fonts).
  if (method === "auto" && !isDisplayMediaSupported()) {
    return await captureViaDom(opts)
  }
  return await withHiddenHost(() => captureViaDisplayMedia())
}
