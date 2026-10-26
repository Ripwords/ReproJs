import { installBridge } from "../bootstrap/bridge"
import { bootRepro, injectConfig, probeBootState, type BootState } from "../bootstrap/set-config"
import { installFetchProxy } from "../bootstrap/proxy-fetch"
import { findConfigForUrl, toOrigin } from "../lib/origin"
import { hasOriginPermission } from "../lib/permissions"
import { listConfigs } from "../lib/storage"
import { registerProxyHandler } from "./proxy-handler"

registerProxyHandler()

// Per-tab dedupe + in-flight lock. Two concurrent tabs.onUpdated firings for
// the same tab (common on framework dev servers that emit multiple complete
// events per navigation) would otherwise both pass the "have I injected?"
// check and race through the executeScript chain, with the second IIFE load
// colliding with the first on attachShadow. Set the Map BEFORE any awaited
// work so the second tryInject sees the entry and bails. Clear on every
// early return, on throw, and when a new document is committed.
//
// The Map is lost when the service worker is torn down (~30s idle in MV3).
// The bootRepro DOM-existence check in set-config.ts is the backstop for
// that case — page-world state survives worker revivals.
const injectedForTab = new Map<number, string>()

async function tryInject(tabId: number, url: string): Promise<void> {
  const origin = toOrigin(url)
  if (origin === null) return

  if (injectedForTab.get(tabId) === origin) return

  // Reserve the slot synchronously, before the first await. Two triggers
  // for the same navigation (onDOMContentLoaded + tabs complete, or the
  // double `complete` that Vite/Next dev servers emit) arrive microseconds
  // apart; anything awaited between the check and the set lets both pass
  // and evaluates the IIFE twice, leaving window.Repro as a second,
  // never-initialised instance. Every early return below MUST release the
  // slot so the fallback trigger can retry.
  injectedForTab.set(tabId, origin)

  const configs = await listConfigs()
  const match = findConfigForUrl(url, configs)
  if (!match) {
    injectedForTab.delete(tabId)
    return
  }

  // Permission may have been revoked in chrome://extensions between tab load
  // and here. Check first so we emit a clear log line instead of a noisy
  // scripting error.
  if (!(await hasOriginPermission(match.origin))) {
    injectedForTab.delete(tabId)
    console.debug("[repro-extension] skip inject: page origin permission missing", match.origin)
    return
  }

  let intakeOrigin: string
  try {
    intakeOrigin = new URL(match.intakeEndpoint).origin
  } catch {
    injectedForTab.delete(tabId)
    console.debug("[repro-extension] bad intakeEndpoint in config", match.id)
    return
  }

  // The proxy fetch runs from the service worker, which needs host
  // permission on the intake origin as well. Without it the widget mounts
  // fine and every submission dies with an opaque "Failed to fetch". Refuse
  // to inject and say why; the popup shows the same config as "pending"
  // with a Grant button.
  if (!(await hasOriginPermission(intakeOrigin))) {
    injectedForTab.delete(tabId)
    console.warn(
      `[repro-extension] skip inject for ${match.origin}: host permission missing for intake ${intakeOrigin}. Open the popup and click Grant.`,
    )
    return
  }

  try {
    // 0. Ask the page world what is already there. This makes the whole
    //    chain idempotent: a pushState navigation (tabs.onUpdated reports a
    //    URL change and clears the dedupe slot), a bfcache restore, or a
    //    revived service worker that lost its Map all re-run tryInject
    //    against a live document. Re-evaluating the IIFE there would swap
    //    window.Repro for a fresh module whose config is null, so the
    //    launcher stays visible but Repro.open() throws "called before
    //    init". Keep the dedupe slot: the page IS injected.
    const [probe] = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      world: "MAIN",
      func: probeBootState,
    })
    const state = probe?.result as BootState | undefined
    if (state === "booted") {
      console.debug("[repro-extension] SDK already booted in tab, skipping", tabId)
      return
    }
    // 1. Write __REPRO_CONFIG__ into the page world.
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      world: "MAIN",
      func: injectConfig,
      args: [match.projectKey, match.intakeEndpoint],
    })
    // 2. Install the fetch proxy BEFORE the SDK loads so the SDK's intake
    //    POST is routed through the service worker instead of hitting the
    //    page's connect-src CSP.
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      world: "MAIN",
      func: installFetchProxy,
      args: [intakeOrigin],
    })
    // 3. Install the ISOLATED-world bridge so window.postMessage from the
    //    fetch proxy can reach chrome.runtime.sendMessage.
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      world: "ISOLATED",
      func: installBridge,
    })
    // 4. Load the bundled SDK IIFE in the page world — skipped when the
    //    probe above found one already evaluated (boot failed half-way or
    //    the host page embeds the SDK itself); bootRepro then only inits.
    if (state !== "sdk-loaded") {
      await chrome.scripting.executeScript({
        target: { tabId, frameIds: [0] },
        world: "MAIN",
        files: ["repro.iife.js"],
      })
    }
    // 5. Call Repro.init(). Guarded against double-init inside bootRepro.
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      world: "MAIN",
      func: bootRepro,
    })
  } catch (err) {
    // Permission denied / tab closed mid-inject / page navigated away.
    // Swallow — the next tabs.onUpdated cycle will retry if the user returns.
    injectedForTab.delete(tabId)
    console.debug("[repro-extension] inject failed", err)
  }
}

// Primary trigger: the main frame's DOM is parsed. This fires even when the
// page never reaches `complete` — a hanging image, a long-poll iframe, or a
// slow third-party script keeps `document.readyState` at "interactive"
// indefinitely, and testers were seeing the launcher appear late or never on
// such pages. `webNavigation` events are per-frame; only the top frame
// (frameId 0) is injectable, matching the executeScript targets below.
chrome.webNavigation.onCommitted.addListener(({ tabId, frameId }) => {
  // A new document is committed in the main frame — the previous page world
  // (and the SDK in it) is gone. Fires for fresh loads, URL changes AND
  // reloads, so it is the most reliable place to drop the dedupe slot.
  if (frameId !== 0) return
  injectedForTab.delete(tabId)
})

chrome.webNavigation.onDOMContentLoaded.addListener(({ tabId, frameId, url }) => {
  if (frameId !== 0) return
  void tryInject(tabId, url)
})

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // A real navigation (fresh load, URL change, OR page refresh) starts with
  // `status: "loading"`. The page-world SDK is gone as of this event, so
  // invalidate the dedupe key *before* the matching "complete" lands — that
  // way tryInject re-injects the SDK. Without this, a refresh leaves the
  // stale dedupe entry in place, tryInject bails, and the user sees no
  // launcher after hitting F5. HMR/Fast-Refresh does NOT emit tabs.onUpdated
  // (modules swap via WebSocket without tab navigation), so this clear is
  // safe — it only fires on genuine navigations.
  if (changeInfo.status === "loading") {
    injectedForTab.delete(tabId)
    return
  }
  // Fallback trigger. webNavigation.onDOMContentLoaded above normally wins;
  // `complete` catches the cases where it did not (service worker revived
  // mid-load and missed the event, or the DOMContentLoaded inject failed
  // and cleared its slot). The dedupe Map makes the second call a no-op
  // when the first one succeeded.
  if (changeInfo.status !== "complete") return
  if (!tab.url) return
  void tryInject(tabId, tab.url)
})

// Belt-and-suspenders: URL change emits earlier than `status: "loading"`
// in some Chrome edge cases (cross-origin redirects, history API). Keep
// this as a secondary trigger so a URL change always wipes the dedupe.
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url) {
    injectedForTab.delete(tabId)
  }
})

chrome.tabs.onRemoved.addListener((tabId) => {
  injectedForTab.delete(tabId)
})
