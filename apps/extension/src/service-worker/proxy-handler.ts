// Handles "proxy-fetch" messages from the ISOLATED-world bridge, performs
// the fetch from the service worker's own origin (which isn't subject to
// the page's connect-src CSP), and returns the response.
//
// Security model:
//   - Any script in the MAIN world of an injected page can postMessage a
//     proxy-fetch request — the bridge forwards without authentication
//     because the whole point is letting page JS talk to the SW.
//   - The SW MUST NOT trust anything in the message beyond its structure.
//     The authoritative source of "which origin is speaking" is
//     sender.tab?.url — populated by Chrome, not forgeable.
//   - To prevent the proxy from being an open SSRF primitive, the SW only
//     forwards fetches whose target URL belongs to the intake endpoint of
//     a stored config for the sender tab's origin.
//   - X-Repro-Origin is set from sender.tab's origin, never from a
//     client-supplied value. A compromised page therefore cannot claim to
//     speak for a different allowlisted origin.
//
// All binaries travel as base64 strings because chrome.runtime.sendMessage
// serializes messages as JSON in MV3, and ArrayBuffer round-trips through
// JSON as {} without this wrapping.

import { listConfigs } from "../lib/storage"

type SerializedBody =
  | { kind: "none" }
  | { kind: "text"; value: string }
  | { kind: "bytes"; b64: string; contentType?: string }
  | {
      kind: "formData"
      entries: Array<
        | { kind: "string"; name: string; value: string }
        | { kind: "blob"; name: string; type: string; filename: string | null; b64: string }
      >
    }

type ProxyAbort = { type: "proxy-abort"; id: string }

type ProxyRequest = {
  type: "proxy-fetch"
  id: string
  url: string
  method: string
  headers: Record<string, string>
  body: SerializedBody
  // Kept for wire compatibility but NEVER trusted. The SW derives the real
  // page origin from sender.tab?.url.
  pageOrigin?: string
}

function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(b64)
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ""
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)))
  }
  return btoa(binary)
}

function deserializeBody(serialized: SerializedBody): BodyInit | undefined {
  if (serialized.kind === "none") return undefined
  if (serialized.kind === "text") return serialized.value
  if (serialized.kind === "bytes") {
    return new Blob([fromBase64(serialized.b64)], {
      type: serialized.contentType ?? "application/octet-stream",
    })
  }
  const fd = new FormData()
  for (const entry of serialized.entries) {
    if (entry.kind === "string") {
      fd.append(entry.name, entry.value)
      continue
    }
    const blob = new Blob([fromBase64(entry.b64)], { type: entry.type })
    if (entry.filename !== null) {
      fd.append(entry.name, blob, entry.filename)
    } else {
      fd.append(entry.name, blob)
    }
  }
  return fd
}

function looksLikeText(contentType: string): boolean {
  if (!contentType) return true // default to text for empty bodies
  return (
    contentType.startsWith("text/") ||
    contentType.includes("json") ||
    contentType.includes("xml") ||
    contentType.includes("javascript") ||
    contentType.includes("html")
  )
}

function reject(sendResponse: (response: unknown) => void, error: string, status = 0): void {
  sendResponse({
    ok: false,
    status,
    statusText: "",
    bodyKind: "none",
    body: null,
    error,
  })
}

// In-flight fetches, keyed by sender tab + request id so a page can only
// abort its own requests. The SDK's AbortSignal (30 s timeout) reaches us
// as a separate "proxy-abort" message relayed by the bridge.
const inflight = new Map<string, AbortController>()

function inflightKey(sender: chrome.runtime.MessageSender, id: string): string {
  return `${sender.tab?.id ?? "?"}:${id}`
}

export function registerProxyHandler(): void {
  chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    const msg = message as Partial<ProxyRequest> | Partial<ProxyAbort> | null
    if (!msg) return false

    if (msg.type === "proxy-abort") {
      if (typeof msg.id === "string") inflight.get(inflightKey(sender, msg.id))?.abort()
      return false
    }
    if (msg.type !== "proxy-fetch") return false

    // Register before the first await so an abort that races the config
    // lookup still lands. Removed in `finally` below.
    const controller = new AbortController()
    const key = typeof msg.id === "string" ? inflightKey(sender, msg.id) : null
    if (key) inflight.set(key, controller)

    void (async () => {
      try {
        if (controller.signal.aborted) {
          reject(sendResponse, "proxy: aborted")
          return
        }
        // F1 guard: require a sender tab and derive its origin ourselves.
        // sender.tab.url is set by Chrome from the actual tab URL — it
        // cannot be spoofed by the page's JS.
        const tabUrl = sender.tab?.url
        if (!tabUrl) {
          reject(sendResponse, "proxy: no sender tab")
          return
        }
        let tabOrigin: string
        try {
          tabOrigin = new URL(tabUrl).origin
        } catch {
          reject(sendResponse, "proxy: unparseable sender tab url")
          return
        }

        if (!msg.url) {
          reject(sendResponse, "proxy: missing url")
          return
        }
        // H2 guard: restrict HTTP methods to what the intake API actually
        // accepts. OPTIONS handles preflights even though the SW fetch
        // doesn't preflight itself — kept permissive only for correctness
        // if the SDK ever probes. Anything else is denied outright so a
        // compromised page can't reach a future DELETE/PATCH route.
        const method = msg.method ?? "GET"
        if (method !== "POST" && method !== "OPTIONS") {
          reject(sendResponse, "proxy: method not allowed")
          return
        }
        let targetUrl: URL
        try {
          targetUrl = new URL(msg.url)
        } catch {
          reject(sendResponse, "proxy: unparseable target url")
          return
        }

        // F1 + F7 guard: target URL must match the intake endpoint of a
        // config whose page origin matches the sender tab. Prevents the SW
        // from becoming an open proxy for arbitrary URLs just because the
        // extension has host permissions for them.
        const configs = await listConfigs()
        const match = configs.find((c) => c.origin === tabOrigin)
        if (!match) {
          reject(sendResponse, "proxy: sender tab origin not in any config")
          return
        }
        let intakeOrigin: string
        try {
          intakeOrigin = new URL(match.intakeEndpoint).origin
        } catch {
          reject(sendResponse, "proxy: config has unparseable intake endpoint")
          return
        }
        if (targetUrl.origin !== intakeOrigin) {
          reject(sendResponse, "proxy: target origin not allowed for this tab")
          return
        }
        // Further bound the path to the intake API. Anything else on the
        // intake host (/admin, /api/tickets, etc.) is off-limits.
        if (!targetUrl.pathname.startsWith("/api/intake/")) {
          reject(sendResponse, "proxy: target path not allowed")
          return
        }

        const body = msg.body ? deserializeBody(msg.body) : undefined

        // H1 guard: header ALLOWLIST, not blocklist. A MAIN-world attacker
        // on an allowlisted tab can post anything in msg.headers, and the
        // SW-authenticated X-Repro-Origin we attach makes the intake treat
        // the whole request as trusted. Blocklisting means every new
        // auth-sensitive or trust-bearing header we don't think of is an
        // attack. Allowlist is O(1) to audit: only content-type (when not
        // FormData; fetch owns it with boundary otherwise) is forwarded.
        // Any other header worth passing gets added here intentionally.
        const headers: Record<string, string> = {}
        const suppliedContentType = msg.headers?.["content-type"] ?? msg.headers?.["Content-Type"]
        if (suppliedContentType && msg.body?.kind !== "formData") {
          headers["content-type"] = suppliedContentType
        }
        // F3 guard: X-Repro-Origin is set from the SW-derived tab origin,
        // NEVER from msg.pageOrigin or any msg.headers entry (those are
        // dropped by the allowlist above). A compromised page cannot
        // claim to speak for a different allowlisted origin.
        headers["x-repro-origin"] = tabOrigin

        const response = await fetch(targetUrl.href, {
          method,
          headers,
          body,
          signal: controller.signal,
        })

        const contentType = response.headers.get("content-type") ?? ""
        let bodyKind: "text" | "bytes" | "none" = "none"
        let responseBody: string | null = null
        if (looksLikeText(contentType)) {
          responseBody = await response.text()
          bodyKind = responseBody.length > 0 ? "text" : "none"
        } else {
          const buf = await response.arrayBuffer()
          bodyKind = buf.byteLength > 0 ? "bytes" : "none"
          responseBody = buf.byteLength > 0 ? arrayBufferToBase64(buf) : null
        }

        sendResponse({
          ok: response.ok,
          status: response.status,
          statusText: response.statusText,
          bodyKind,
          body: responseBody,
          contentType,
        })
      } catch (err) {
        reject(sendResponse, err instanceof Error ? err.message : String(err))
      } finally {
        if (key) inflight.delete(key)
      }
    })()

    // Return true to keep the message channel open for the async sendResponse.
    return true
  })
}
