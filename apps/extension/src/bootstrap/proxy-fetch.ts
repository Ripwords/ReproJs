// Runs in the page's MAIN world via chrome.scripting.executeScript({ func }).
// Must be self-contained — no imports — because executeScript serializes the
// function to a string before evaluating it inside the tab.
//
// Monkey-patches window.fetch so that any request whose URL starts with the
// extension's configured intake endpoint is routed through the extension
// service worker instead of going out from the page context. This sidesteps
// the page's Content-Security-Policy `connect-src`, which would otherwise
// refuse the SDK's report POST on CSP-strict apps.
//
// The proxy posts a repro-proxy message on window.postMessage, which is
// picked up by the ISOLATED-world bridge (apps/extension/src/bootstrap/
// bridge.ts), forwarded to the service worker over chrome.runtime.sendMessage,
// fetched there, and the response is relayed back.

// `maxRawBodyBytes` is computed by the service worker from lib/proxy-limits
// and passed in as an argument, because this function cannot import it.
export function installFetchProxy(endpointOrigin: string, maxRawBodyBytes: number): void {
  const g = globalThis as unknown as {
    __REPRO_PROXY_INSTALLED__?: boolean
    __REPRO_PROXY_ORIGIN__?: string
    fetch: typeof fetch
  }
  if (g.__REPRO_PROXY_INSTALLED__) return
  g.__REPRO_PROXY_INSTALLED__ = true
  g.__REPRO_PROXY_ORIGIN__ = endpointOrigin

  const SOURCE = "repro-proxy"
  const originalFetch = g.fetch.bind(globalThis)
  const pending = new Map<string, (response: unknown) => void>()
  console.info("[repro-extension] fetch proxy installed for", endpointOrigin)

  window.addEventListener("message", (event) => {
    if (event.source !== window) return
    const data = event.data as { source?: string; type?: string; id?: string } | null
    if (!data || data.source !== SOURCE || data.type !== "response") return
    if (typeof data.id !== "string") return
    const resolver = pending.get(data.id)
    if (!resolver) return
    pending.delete(data.id)
    resolver(data)
  })

  // Nested helpers stay inside installFetchProxy because executeScript({func})
  // serializes the outer function to a string; references to module-scope
  // identifiers would be undefined when the serialized body runs in the page.
  // oxlint-disable-next-line eslint-plugin-unicorn/consistent-function-scoping
  function toBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer)
    let binary = ""
    const CHUNK = 0x8000
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)))
    }
    return btoa(binary)
  }

  // oxlint-disable-next-line eslint-plugin-unicorn/consistent-function-scoping
  function fromBase64(b64: string): ArrayBuffer {
    const binary = atob(b64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes.buffer
  }

  // Raw byte count of a body before base64 inflation. Strings count by
  // UTF-16 length, which is within a factor of the UTF-8 size and only has
  // to be a conservative estimate against a limit with headroom.
  // oxlint-disable-next-line eslint-plugin-unicorn/consistent-function-scoping
  function rawBodyBytes(body: BodyInit | null | undefined): number {
    if (body == null) return 0
    if (typeof body === "string") return body.length
    if (body instanceof ArrayBuffer) return body.byteLength
    if (ArrayBuffer.isView(body)) return body.byteLength
    if (body instanceof Blob) return body.size
    if (body instanceof FormData) {
      let total = 0
      for (const [name, value] of body.entries()) {
        total += name.length + (typeof value === "string" ? value.length : (value as Blob).size)
      }
      return total
    }
    if (body instanceof URLSearchParams) return body.toString().length
    return 0
  }

  async function serializeBody(body: BodyInit | null | undefined): Promise<unknown> {
    if (body == null) return { kind: "none" }
    if (typeof body === "string") return { kind: "text", value: body }
    if (body instanceof ArrayBuffer) return { kind: "bytes", b64: toBase64(body) }
    if (body instanceof Blob) {
      return { kind: "bytes", b64: toBase64(await body.arrayBuffer()), contentType: body.type }
    }
    if (body instanceof FormData) {
      const entries: unknown[] = []
      for (const [name, value] of body.entries()) {
        if (typeof value === "string") {
          entries.push({ kind: "string", name, value })
        } else {
          const blob = value as Blob
          entries.push({
            kind: "blob",
            name,
            type: blob.type,
            filename: (blob as File).name ?? null,
            b64: toBase64(await blob.arrayBuffer()),
          })
        }
      }
      return { kind: "formData", entries }
    }
    // URLSearchParams and ReadableStream fall back to text; our intake never
    // sends a stream body.
    return { kind: "text", value: String(body) }
  }

  g.fetch = async function proxiedFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const rawUrl = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
    let targetUrl: string
    try {
      targetUrl = new URL(rawUrl, location.href).href
    } catch {
      return originalFetch(input, init)
    }
    if (!targetUrl.startsWith(endpointOrigin)) {
      return originalFetch(input, init)
    }
    console.info("[repro-extension] proxying fetch →", targetUrl)

    // The SDK passes AbortSignal.timeout(30_000). Without forwarding it the
    // SDK's timeout only rejected the page-side promise while the service
    // worker kept uploading, and the proxy's own 60 s timer was the only
    // real bail-out.
    const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined)
    if (signal?.aborted) {
      throw signal.reason instanceof Error
        ? signal.reason
        : new DOMException("The operation was aborted.", "AbortError")
    }

    const method = init?.method ?? (input instanceof Request ? input.method : "GET")
    const headersInit = init?.headers ?? (input instanceof Request ? input.headers : undefined)
    const headers: Record<string, string> = {}
    if (headersInit) {
      const h = new Headers(headersInit)
      h.forEach((value, key) => {
        headers[key] = value
      })
    }

    let bodyInit: BodyInit | null | undefined = init?.body
    if (bodyInit == null && input instanceof Request) {
      try {
        bodyInit = await input.clone().arrayBuffer()
      } catch {
        bodyInit = null
      }
    }
    // Chrome caps runtime.sendMessage payloads; a body that would blow past
    // it after base64 inflation dies inside the bridge with an unhelpful
    // error and a 60 s hang. Hand it to the page's real fetch instead — on a
    // CSP-strict host that may be blocked too, but then the SDK sees a
    // normal, immediate network error rather than a silent stall.
    const rawBytes = rawBodyBytes(bodyInit)
    if (rawBytes > maxRawBodyBytes) {
      console.warn(
        `[repro-extension] request body is ${rawBytes} bytes, above the ${maxRawBodyBytes}-byte proxy limit; sending through the page's own fetch instead (CSP connect-src may block it)`,
      )
      return originalFetch(input, init)
    }
    const body = await serializeBody(bodyInit ?? null)

    // The service worker will override the browser's Origin header (which
    // would otherwise be chrome-extension://<id>) to the page's real origin
    // so the intake's allowlist check behaves the same as when the SDK
    // posts directly. `location.origin` is the MAIN-world document's own
    // origin — the one the tester configured.
    // crypto.randomUUID() instead of a time+counter id — unpredictable ids
    // make it harder for a hostile MAIN-world script to race the response
    // handler by pre-registering a matching id. Residual risk (any script
    // on the page can still passively snoop repro-proxy-response messages)
    // is bounded by F1's SW-side URL gating: the only data broadcast over
    // this channel is the intake response body, which contains only the
    // new report ID and not sensitive data.
    const id = crypto.randomUUID()
    const request = {
      source: SOURCE,
      type: "request",
      id,
      url: targetUrl,
      method,
      headers,
      body,
      pageOrigin: location.origin,
    }

    const response = await new Promise<{
      ok: boolean
      status: number
      statusText: string
      bodyKind: "text" | "bytes" | "none"
      body: string | null
      contentType?: string
      error?: string
      fallback?: boolean
    }>((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(id)
        signal?.removeEventListener("abort", onAbort)
        reject(new Error("repro proxy: timeout"))
      }, 60_000)
      function onAbort(): void {
        clearTimeout(timeout)
        pending.delete(id)
        // Tell the service worker to cancel the in-flight fetch too;
        // otherwise the upload keeps running after the SDK gave up.
        window.postMessage({ source: SOURCE, type: "abort", id }, window.location.origin)
        reject(
          signal?.reason instanceof Error
            ? signal.reason
            : new DOMException("The operation was aborted.", "AbortError"),
        )
      }
      signal?.addEventListener("abort", onAbort, { once: true })
      pending.set(id, (msg) => {
        clearTimeout(timeout)
        signal?.removeEventListener("abort", onAbort)
        resolve(
          msg as {
            ok: boolean
            status: number
            statusText: string
            bodyKind: "text" | "bytes" | "none"
            body: string | null
            contentType?: string
            error?: string
            fallback?: boolean
          },
        )
      })
      window.postMessage(request, window.location.origin)
    })

    if (response.fallback) {
      // The bridge could not reach the service worker (extension reloaded
      // or updated underneath this page). The proxy is dead for the rest of
      // this document's life; the page's own fetch is the only route left.
      console.warn(
        `[repro-extension] ${response.error ?? "bridge unavailable"}; sending through the page's own fetch instead (CSP connect-src may block it)`,
      )
      return originalFetch(input, init)
    }
    if (response.error) {
      throw new TypeError(`repro proxy: ${response.error}`)
    }

    let responseBody: BodyInit | null = null
    if (response.bodyKind === "text" && typeof response.body === "string") {
      responseBody = response.body
    } else if (response.bodyKind === "bytes" && typeof response.body === "string") {
      responseBody = fromBase64(response.body)
    }

    return new Response(responseBody, {
      status: response.status,
      statusText: response.statusText,
      headers: response.contentType ? { "content-type": response.contentType } : undefined,
    })
  }
}
