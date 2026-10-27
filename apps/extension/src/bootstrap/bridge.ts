// Runs in the page's ISOLATED world via chrome.scripting.executeScript({
// func, world: "ISOLATED" }). Isolated world has access to chrome.runtime.*
// but shares the tab's DOM with the MAIN world, so it can use
// window.postMessage / addEventListener("message") to talk to the fetch
// proxy installed by proxy-fetch.ts.
//
// Self-contained — no imports, no closures.

export function installBridge(): void {
  const g = globalThis as unknown as { __REPRO_BRIDGE_INSTALLED__?: boolean }
  if (g.__REPRO_BRIDGE_INSTALLED__) return
  g.__REPRO_BRIDGE_INSTALLED__ = true

  const SOURCE = "repro-proxy"

  window.addEventListener("message", (event) => {
    if (event.source !== window) return
    const data = event.data as {
      source?: string
      type?: string
      id?: string
      url?: string
      method?: string
      headers?: Record<string, string>
      body?: unknown
      pageOrigin?: string
    } | null
    if (!data || data.source !== SOURCE) return
    if (typeof data.id !== "string") return
    const id = data.id

    if (data.type === "abort") {
      // Best-effort cancel of the in-flight service-worker fetch. The page
      // side has already rejected its promise; nothing to report back.
      try {
        void chrome.runtime.sendMessage({ type: "proxy-abort", id }).catch(() => {})
      } catch {
        // Orphaned bridge (extension reloaded) — nothing left to cancel.
      }
      return
    }
    if (data.type !== "request") return

    // After the extension is reloaded or updated this content script keeps
    // running but its chrome.runtime is dead: sendMessage throws
    // synchronously ("Extension context invalidated"). Without the catch the
    // page side waits out its full upload deadline on every submission. Answer
    // immediately with `fallback: true` so the proxy hands the request to
    // the page's own fetch.
    let sent: Promise<unknown>
    try {
      sent = chrome.runtime.sendMessage({
        type: "proxy-fetch",
        id,
        url: data.url,
        method: data.method,
        headers: data.headers,
        body: data.body,
        pageOrigin: data.pageOrigin,
      })
    } catch (err) {
      window.postMessage(
        {
          source: SOURCE,
          type: "response",
          id,
          ok: false,
          status: 0,
          statusText: "",
          bodyKind: "none",
          body: null,
          fallback: true,
          error: `bridge: ${err instanceof Error ? err.message : String(err)}`,
        },
        window.location.origin,
      )
      return
    }

    sent
      .then((response: unknown) => {
        const payload =
          response && typeof response === "object"
            ? (response as Record<string, unknown>)
            : { error: "empty response from service worker" }
        window.postMessage(
          { source: SOURCE, type: "response", id, ...payload },
          window.location.origin,
        )
        return
      })
      .catch((err: unknown) => {
        // Rejected rather than thrown: the service worker is gone or never
        // answered ("Could not establish connection", "message port closed").
        // Same remedy — let the page try the network itself.
        window.postMessage(
          {
            source: SOURCE,
            type: "response",
            id,
            ok: false,
            status: 0,
            statusText: "",
            bodyKind: "none",
            body: null,
            fallback: true,
            error: `bridge: ${err instanceof Error ? err.message : String(err)}`,
          },
          window.location.origin,
        )
      })
  })
}
