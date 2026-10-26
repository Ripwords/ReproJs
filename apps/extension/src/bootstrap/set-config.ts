// These functions are serialized by chrome.scripting.executeScript's `func`
// option. They run in the page's MAIN world, so they must be self-contained
// — no closures over module-scope values.

export function injectConfig(projectKey: string, endpoint: string): void {
  const g = globalThis as unknown as { __REPRO_CONFIG__?: unknown }
  g.__REPRO_CONFIG__ = { projectKey, endpoint, source: "extension" }
}

export function bootRepro(): void {
  const g = globalThis as unknown as {
    __REPRO_CONFIG__?: { projectKey: string; endpoint: string }
    __REPRO_BOOTED__?: boolean
    Repro?: { init: (opts: { projectKey: string; endpoint: string }) => void }
  }
  // Two-layer guard. The IIFE's shadow-DOM host is keyed in a module-scoped
  // WeakMap, so a second IIFE load gets a fresh empty WeakMap and tries to
  // re-attachShadow on the same host element, throwing NotSupportedError.
  //
  //   (1) window sentinel — catches the common case where both bootRepro
  //       calls share window state.
  //   (2) DOM existence check — authoritative fallback when the window
  //       sentinel is somehow wiped (Turbopack/Fast-Refresh edge cases,
  //       history replacement, or an earlier failed mount that left the
  //       host element in the DOM).
  if (g.__REPRO_BOOTED__) return
  if (document.getElementById("repro-host")) {
    g.__REPRO_BOOTED__ = true
    return
  }
  const cfg = g.__REPRO_CONFIG__
  if (!cfg || !g.Repro) return
  g.__REPRO_BOOTED__ = true
  try {
    g.Repro.init({ projectKey: cfg.projectKey, endpoint: cfg.endpoint })
  } catch (err) {
    // Belt-and-suspenders: if we somehow slipped past both guards (racing
    // injections, host element created between the check and this line,
    // a fresh IIFE module instance reading an empty WeakMap), swallow the
    // attachShadow NotSupportedError instead of bubbling it to the page.
    // The prior init already mounted the widget; a failed duplicate init
    // isn't user-visible, and leaving the error uncaught makes it look
    // like the extension broke the page.
    console.debug("[repro-extension] Repro.init skipped:", err)
  }
}

export type BootState = "booted" | "sdk-loaded" | "fresh"

// Answers "what is already in this page world?" so the service worker can
// skip the steps that would clobber a live SDK. Re-evaluating repro.iife.js
// over an initialised instance replaces window.Repro with a fresh module
// whose `_config` is null — the launcher stays on screen but Repro.open()
// then throws "called before init". That happens whenever tryInject runs a
// second time against the same document: pushState navigations (tabs.
// onUpdated reports a URL change and clears the dedupe slot), bfcache
// restores, or a service worker revival that lost its in-memory Map.
export function probeBootState(): BootState {
  const g = globalThis as unknown as { __REPRO_BOOTED__?: boolean; Repro?: unknown }
  if (g.__REPRO_BOOTED__ || document.getElementById("repro-host")) return "booted"
  if (g.Repro) return "sdk-loaded"
  return "fresh"
}
