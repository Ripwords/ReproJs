import type { CollectorConfig } from "@reprojs/ui"
import type { CaptureMethod } from "./screenshot"

export interface ReplayInitConfig {
  enabled?: boolean
  masking?: "strict" | "moderate" | "minimal"
  maskSelectors?: string[]
  blockSelectors?: string[]
  maxBytes?: number
}

export interface ScreenshotConfig {
  // Which capture path to use:
  //   "auto" (default) — try the browser's getDisplayMedia first
  //     (pixel-perfect, ~50ms after the user accepts the "Share this tab?"
  //     prompt), fall back to the DOM path on denial / unavailability.
  //   "display-media" — require getDisplayMedia; return null if missing
  //     or denied. No fallback.
  //   "dom" — skip the prompt entirely; use modern-screenshot. Slower on
  //     heavy pages but no permission flow.
  method?: CaptureMethod
  // CSS selectors for elements to omit from the DOM-path snapshot. No
  // effect on the display-media path (which captures real pixels and
  // doesn't traverse the DOM). Useful for third-party widgets that stall
  // modern-screenshot: Vercel toolbar, Intercom, Storybook addons, etc.
  excludeSelectors?: string[]
}

export interface InitOptions {
  projectKey: string
  endpoint: string
  position?: "bottom-right" | "bottom-left" | "top-right" | "top-left"
  launcher?: boolean
  metadata?: Record<string, string | number | boolean>
  collectors?: CollectorConfig
  replay?: ReplayInitConfig
  screenshot?: ScreenshotConfig
  // Keyboard shortcut that opens the launcher menu, e.g. "ctrl+shift+b".
  // Default undefined = no shortcut. An unparseable spec is silently ignored
  // (fail open) — see hotkey.ts.
  hotkey?: string
}

export interface ResolvedConfig {
  projectKey: string
  endpoint: string
  position: "bottom-right" | "bottom-left" | "top-right" | "top-left"
  launcher: boolean
  metadata: Record<string, string | number | boolean> | undefined
  replay: ReplayInitConfig | undefined
  screenshot: ScreenshotConfig | undefined
  hotkey: string | undefined
}

const KEY_RE = /^rp_pk_[A-Za-z0-9]{24}$/

export function resolveConfig(opts: InitOptions): ResolvedConfig {
  if (!opts || typeof opts.projectKey !== "string" || !KEY_RE.test(opts.projectKey)) {
    throw new Error("Repro.init: projectKey is required and must match rp_pk_[24 base62 chars]")
  }
  let endpoint: string
  try {
    const u = new URL(opts.endpoint)
    endpoint = u.origin + u.pathname.replace(/\/+$/, "")
    if (endpoint.endsWith("/")) endpoint = endpoint.slice(0, -1)
  } catch {
    throw new Error("Repro.init: endpoint must be a valid absolute URL")
  }
  return {
    projectKey: opts.projectKey,
    endpoint,
    position: opts.position ?? "bottom-right",
    launcher: opts.launcher ?? true,
    metadata: opts.metadata,
    replay: opts.replay,
    screenshot: opts.screenshot,
    hotkey: opts.hotkey,
  }
}
