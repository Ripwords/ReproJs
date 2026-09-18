import { domToBlob } from "modern-screenshot"
import { captureViaDisplayMedia } from "./display-media"

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
  //   "auto" / "display-media" — use the browser's getDisplayMedia
  //     (pixel-perfect, ~50ms after the user accepts the "Share this tab?"
  //     prompt, no DOM cloning, no font inlining, no shadow-DOM traps).
  //     Returns null if the user declines or the API is unavailable. Does
  //     NOT fall back to DOM capture: the fallback could stall indefinitely
  //     on heavy pages (CSS-in-JS, web components, slow CDN fonts) and a
  //     hung "Capturing…" overlay is strictly worse than a missing
  //     screenshot — the wizard keeps moving with the description step.
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

async function captureViaDom(opts: CaptureOptions): Promise<Blob | null> {
  try {
    return await domToBlob(document.documentElement, {
      scale: window.devicePixelRatio || 1,
      width: window.innerWidth,
      height: window.innerHeight,
      // Opt-in in modern-screenshot (every other feature defaults on). Without
      // it the clone renders from scroll offset zero, so a scrolled page — or a
      // scrolled sidebar/table/list inside it — captures its top, not what the
      // reporter was looking at.
      features: { restoreScrollPosition: true },
      filter: buildFilter(opts),
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
  // "auto" and "display-media" both behave identically now: try the browser's
  // screen capture once and return null on any failure (user declined, API
  // missing, track errored). Historically "auto" fell back to modern-
  // screenshot on failure, but that path stalls indefinitely on real apps
  // (Next.js dev overlays, CSS-in-JS, slow-inlining CDN fonts) and strands
  // users on "Capturing…". A null screenshot lets the wizard advance to the
  // description step without blocking.
  return await withHiddenHost(() => captureViaDisplayMedia())
}
