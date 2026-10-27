import { installBridge } from "../bootstrap/bridge"
import { bootRepro, injectConfig, probeBootState, type BootState } from "../bootstrap/set-config"
import { installFetchProxy } from "../bootstrap/proxy-fetch"
import { findConfigForUrl, toOrigin } from "../lib/origin"
import { hasOriginPermission } from "../lib/permissions"
import { MAX_PROXY_RAW_BODY_BYTES } from "../lib/proxy-limits"
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
//
// Each entry also carries a `run` token unique to the tryInject call that
// reserved it. A navigation committed while that call is awaiting clears the
// slot (and the next tryInject re-reserves it with a fresh token), so after
// every await the in-flight call checks the token is still its own and bails
// otherwise — the remaining executeScript steps would land in the new
// document carrying the previous page's config.
interface InjectSlot {
  origin: string
  run: symbol
}
const injectedForTab = new Map<number, InjectSlot>()

// Written by scripts/sync-sdk.ts next to the copied IIFE. Read once per
// worker lifetime; "unknown" keeps the boot log line useful if the file is
// somehow missing rather than failing the inject.
let sdkVersionPromise: Promise<string> | null = null
function bundledSdkVersion(): Promise<string> {
  sdkVersionPromise ??= fetch(chrome.runtime.getURL("sdk-version.json"))
    .then((res) => res.json() as Promise<{ version?: string }>)
    .then((json) => json.version ?? "unknown")
    .catch(() => "unknown")
  return sdkVersionPromise
}

async function tryInject(tabId: number, url: string): Promise<void> {
  const origin = toOrigin(url)
  if (origin === null) return

  if (injectedForTab.get(tabId)?.origin === origin) return

  // Reserve the slot synchronously, before the first await. Two triggers
  // for the same navigation (onDOMContentLoaded + tabs complete, or the
  // double `complete` that Vite/Next dev servers emit) arrive microseconds
  // apart; anything awaited between the check and the set lets both pass
  // and evaluates the IIFE twice, leaving window.Repro as a second,
  // never-initialised instance. Every early return below MUST release the
  // slot so the fallback trigger can retry.
  const run = Symbol("inject")
  injectedForTab.set(tabId, { origin, run })
  // Still the call that owns this tab's slot? False once a navigation
  // committed mid-flight cleared it or a newer tryInject re-reserved it.
  const owns = () => injectedForTab.get(tabId)?.run === run
  // Release only our own reservation — never a newer call's.
  const release = () => {
    if (owns()) injectedForTab.delete(tabId)
  }

  const configs = await listConfigs()
  if (!owns()) return
  const match = findConfigForUrl(url, configs)
  if (!match) {
    release()
    return
  }

  // Permission may have been revoked in chrome://extensions between tab load
  // and here. Check first so we emit a clear log line instead of a noisy
  // scripting error.
  const hasPagePermission = await hasOriginPermission(match.origin)
  if (!owns()) return
  if (!hasPagePermission) {
    release()
    console.debug("[repro-extension] skip inject: page origin permission missing", match.origin)
    return
  }

  let intakeOrigin: string
  try {
    intakeOrigin = new URL(match.intakeEndpoint).origin
  } catch {
    release()
    console.debug("[repro-extension] bad intakeEndpoint in config", match.id)
    return
  }

  // The proxy fetch runs from the service worker, which needs host
  // permission on the intake origin as well. Without it the widget mounts
  // fine and every submission dies with an opaque "Failed to fetch". Refuse
  // to inject and say why; the popup shows the same config as "pending"
  // with a Grant button.
  const hasIntakePermission = await hasOriginPermission(intakeOrigin)
  if (!owns()) return
  if (!hasIntakePermission) {
    release()
    console.warn(
      `[repro-extension] skip inject for ${match.origin}: host permission missing for intake ${intakeOrigin}. Open the popup and click Grant.`,
    )
    return
  }

  try {
    // 0. Ask the page world what is already there. This makes the whole
    //    chain idempotent: a bfcache restore, a `complete` that lands after
    //    a failed DOMContentLoaded inject, or a revived service worker that
    //    lost its Map all re-run tryInject against a live document.
    //    Re-evaluating the IIFE there would swap
    //    window.Repro for a fresh module whose config is null, so the
    //    launcher stays visible but Repro.open() throws "called before
    //    init". Keep the dedupe slot: the page IS injected.
    const [probe] = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      world: "MAIN",
      func: probeBootState,
    })
    if (!owns()) return
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
      args: [match.projectKey, match.intakeEndpoint, match.relatedIssueField],
    })
    if (!owns()) return
    // 2. Install the fetch proxy BEFORE the SDK loads so the SDK's intake
    //    POST is routed through the service worker instead of hitting the
    //    page's connect-src CSP.
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      world: "MAIN",
      func: installFetchProxy,
      args: [intakeOrigin, MAX_PROXY_RAW_BODY_BYTES],
    })
    if (!owns()) return
    // 3. Install the ISOLATED-world bridge so window.postMessage from the
    //    fetch proxy can reach chrome.runtime.sendMessage.
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      world: "ISOLATED",
      func: installBridge,
    })
    if (!owns()) return
    // 4. Load the bundled SDK IIFE in the page world — skipped when the
    //    probe above found one already evaluated (boot failed half-way or
    //    the host page embeds the SDK itself); bootRepro then only inits.
    if (state !== "sdk-loaded") {
      await chrome.scripting.executeScript({
        target: { tabId, frameIds: [0] },
        world: "MAIN",
        files: ["repro.iife.js"],
      })
      if (!owns()) return
    }
    const sdkVersion = await bundledSdkVersion()
    if (!owns()) return
    // 5. Call Repro.init(). Guarded against double-init inside bootRepro.
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      world: "MAIN",
      func: bootRepro,
      args: [sdkVersion],
    })
  } catch (err) {
    // Permission denied / tab closed mid-inject / page navigated away.
    // Swallow — the next tabs.onUpdated cycle will retry if the user returns.
    release()
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

// Deliberately NO `changeInfo.url` listener. Real navigations already clear
// the slot via webNavigation.onCommitted and `status: "loading"` above. The
// only extra case a URL listener covered was pushState/replaceState, where
// the document (and the booted SDK in it) survives — clearing the slot there
// let a second tryInject race one still in flight and re-evaluate the IIFE,
// replacing window.Repro with an un-inited module.

chrome.tabs.onRemoved.addListener((tabId) => {
  injectedForTab.delete(tabId)
})
