// packages/ui/src/collectors/network.ts
import { RingBuffer, redactBody, redactHeaders, redactUrl } from "@reprojs/sdk-utils"
import { DEFAULT_STRING_REDACTORS, scrubString } from "./serialize"

export interface NetworkEntry {
  id: string
  ts: number
  method: string
  url: string
  status: number | null
  durationMs: number | null
  size: number | null
  initiator: "fetch" | "xhr"
  requestHeaders?: Record<string, string>
  responseHeaders?: Record<string, string>
  requestBody?: string
  responseBody?: string
  error?: string
}

export interface NetworkConfig {
  maxEntries?: number
  requestBody?: boolean
  responseBody?: boolean
  maxBodyBytes?: number
  allowedHeaders?: string[]
  allHeaders?: boolean
  redactQueryParams?: boolean
  enabled?: boolean
  // Forwarded from the top-level CollectorConfig so captured body contents get
  // the same JWT/PAT/AWS/Slack/Bearer scrubbing as console args do.
  stringRedactors?: RegExp[]
}

export interface NetworkCollector {
  start(config: NetworkConfig): void
  /** Drains the buffer. Prefer `peek()` + `clear()` so a failed upload can retry with the same logs. */
  snapshot(): NetworkEntry[]
  peek(): NetworkEntry[]
  clear(): void
  stop(): void
}

function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

// Produce a short, safe descriptor for non-string fetch bodies. Default mode
// (deep=false) never reads contents — FormData may hold file blobs,
// URLSearchParams may carry auth, and ReadableStream can only be consumed once.
// A descriptor is enough to tell the user "a POST happened with body of shape X".
//
// Deep mode (deep=true) is used when the caller has opted into requestBody
// capture: text parts of FormData/URLSearchParams are inlined through the
// supplied scrubber so the request body is fully inspectable in the dashboard,
// while Blob/File parts still get a safe descriptor (binary can't be stringified
// meaningfully). Totals still respect maxBytes.
function describeBody(
  body: unknown,
  deep: boolean,
  scrub: (s: string) => string,
  maxBytes: number,
): string {
  if (typeof FormData !== "undefined" && body instanceof FormData) {
    const entries: string[] = []
    body.forEach((v, k) => {
      if (typeof v === "string") {
        entries.push(deep ? `${k}=${scrub(v)}` : k)
      } else if (typeof Blob !== "undefined" && v instanceof Blob) {
        entries.push(
          `${k}=<${(v as Blob).type || "application/octet-stream"} ${(v as Blob).size}B>`,
        )
      } else {
        entries.push(k)
      }
    })
    const text = deep ? entries.join("\n") : entries.join(", ")
    const header = `[FormData: ${entries.length} field${entries.length === 1 ? "" : "s"}]`
    const combined = entries.length === 0 ? header : `${header}\n${text}`
    return combined.length > maxBytes ? `${combined.slice(0, maxBytes)}… [truncated]` : combined
  }
  if (typeof Blob !== "undefined" && body instanceof Blob) {
    return `[Blob: ${body.type || "application/octet-stream"}, ${body.size} bytes]`
  }
  if (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams) {
    const pairs: string[] = []
    body.forEach((v, k) => {
      pairs.push(deep ? `${k}=${scrub(v)}` : k)
    })
    const header = `[URLSearchParams: ${pairs.length} param${pairs.length === 1 ? "" : "s"}]`
    const combined = pairs.length === 0 ? header : `${header}\n${pairs.join("&")}`
    return combined.length > maxBytes ? `${combined.slice(0, maxBytes)}… [truncated]` : combined
  }
  if (typeof ArrayBuffer !== "undefined" && body instanceof ArrayBuffer) {
    return `[ArrayBuffer: ${body.byteLength} bytes]`
  }
  if (ArrayBuffer.isView(body)) {
    return `[${body.constructor.name}: ${body.byteLength} bytes]`
  }
  if (typeof ReadableStream !== "undefined" && body instanceof ReadableStream) {
    return "[ReadableStream]"
  }
  return "[non-string body]"
}

function headersToObject(h: Headers | Record<string, string> | undefined): Record<string, string> {
  if (!h) return {}
  if (h instanceof Headers) {
    const out: Record<string, string> = {}
    h.forEach((v, k) => {
      out[k] = v
    })
    return out
  }
  return { ...h }
}

async function readResponseBody(res: Response, entry: NetworkEntry, maxBytes: number) {
  try {
    const text = await res.clone().text()
    if (entry.size === null) entry.size = text.length
    entry.responseBody = redactBody(text, { maxBytes }) ?? undefined
  } catch {
    // Body unreadable (opaque, already consumed, aborted) — keep the entry
    // without it rather than failing the fetch.
  }
}

export function createNetworkCollector(_initial: NetworkConfig): NetworkCollector {
  let buffer: RingBuffer<NetworkEntry> | null = null
  let originalFetch: typeof globalThis.fetch | null = null
  // Our own wrapper, so stop() can tell whether it is still the installed fetch.
  let wrappedFetch: typeof globalThis.fetch | null = null
  let originalXHROpen: XMLHttpRequest["open"] | null = null
  let originalXHRSend: XMLHttpRequest["send"] | null = null
  let running = false
  let cfg: NetworkConfig = {}

  function wrapFetch() {
    const orig = globalThis.fetch
    originalFetch = orig
    const maxBody = cfg.maxBodyBytes ?? 16_384
    const wrapper = async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? (input instanceof Request ? input.method : "GET")
      const rawUrl =
        input instanceof Request ? input.url : typeof input === "string" ? input : input.toString()
      const url = cfg.redactQueryParams === false ? rawUrl : redactUrl(rawUrl)
      const started = performance.now()
      const ts = Date.now()
      const id = uid()

      // Always produce a descriptor for non-string bodies (FormData/Blob/etc.)
      // so the Network tab shows something useful even when requestBody capture
      // is off. When opted in, deep-inspect text parts of FormData/URLSearchParams.
      // For string bodies, capture the body itself only when opted in.
      let requestBody: string | undefined
      const body = init?.body
      const stringScrub = (s: string) =>
        scrubString(s, cfg.stringRedactors ?? DEFAULT_STRING_REDACTORS)
      if (cfg.requestBody && typeof body === "string") {
        requestBody = stringScrub(redactBody(body, { maxBytes: maxBody }) ?? "") || undefined
      } else if (body !== undefined && body !== null && typeof body !== "string") {
        requestBody = describeBody(body, Boolean(cfg.requestBody), stringScrub, maxBody)
      }

      // Prefer init.headers, but fall back to input.headers when input is a
      // Request object (e.g., callers that pre-build a Request). Many real
      // fetches set only the default Content-Type via FormData — surface that
      // via the response side since the browser decides the final value.
      let requestHeaders: Record<string, string> | undefined
      const headerSrc = init?.headers ?? (input instanceof Request ? input.headers : undefined)
      if (headerSrc) {
        const raw = headersToObject(headerSrc as Headers | Record<string, string>)
        if (Object.keys(raw).length > 0) {
          requestHeaders = redactHeaders(raw, "request", {
            allowed: cfg.allowedHeaders,
            all: cfg.allHeaders,
            // `allHeaders` is an explicit SDK-config opt-in documented as
            // "you know Authorization / Set-Cookie may be captured" — pass
            // the acknowledgement through to redactHeaders so its safeguard
            // doesn't fire.
            unsafe: cfg.allHeaders,
          })
        }
      }

      try {
        const res = await orig(input, init)
        const durationMs = performance.now() - started
        const responseHeaders = redactHeaders(headersToObject(res.headers), "response", {
          allowed: cfg.allowedHeaders,
          all: cfg.allHeaders,
          unsafe: cfg.allHeaders,
        })

        // Size from Content-Length is free; fall back to body-read length only
        // when responseBody capture is opted in. This means the Size column
        // always has a number when the server returned Content-Length.
        let size: number | null = null
        const cl = res.headers.get("content-length")
        if (cl !== null) {
          const parsed = Number.parseInt(cl, 10)
          if (Number.isFinite(parsed) && parsed >= 0) size = parsed
        }
        const entry: NetworkEntry = {
          id,
          ts,
          method,
          url,
          status: res.status,
          durationMs,
          size,
          initiator: "fetch",
          requestHeaders,
          responseHeaders,
          requestBody,
        }
        buffer?.push(entry)
        if (cfg.responseBody) {
          // Read the clone in the background and patch the entry in place.
          // Awaiting the body here would hold the host's `await fetch()`
          // until the stream closes — a streaming/SSE response never does,
          // so the host would hang.
          void readResponseBody(res, entry, maxBody)
        }
        return res
      } catch (err) {
        const durationMs = performance.now() - started
        buffer?.push({
          id,
          ts,
          method,
          url,
          status: null,
          durationMs,
          size: null,
          initiator: "fetch",
          requestHeaders,
          requestBody,
          error: err instanceof Error ? err.message : String(err),
        })
        throw err
      }
    }
    wrappedFetch = wrapper
    globalThis.fetch = wrapper
  }

  function wrapXHR() {
    const proto = XMLHttpRequest.prototype
    const origOpen = proto.open
    const origSend = proto.send
    originalXHROpen = origOpen
    originalXHRSend = origSend
    type Patched = XMLHttpRequest & {
      __ftMethod?: string
      __ftUrl?: string
      __ftStart?: number
      __ftId?: string
      __ftTs?: number
    }
    proto.open = function (this: Patched, method: string, url: string, ...rest: unknown[]) {
      this.__ftMethod = method
      this.__ftUrl = cfg.redactQueryParams === false ? url : redactUrl(url)
      this.__ftId = uid()
      return origOpen.call(this as XMLHttpRequest, method, url, ...(rest as [boolean?]))
    }
    proto.send = function (this: Patched, body?: Document | XMLHttpRequestBodyInit | null) {
      this.__ftStart = performance.now()
      this.__ftTs = Date.now()
      this.addEventListener("loadend", () => {
        const durationMs = this.__ftStart !== undefined ? performance.now() - this.__ftStart : null
        buffer?.push({
          id: this.__ftId ?? uid(),
          ts: this.__ftTs ?? Date.now(),
          method: this.__ftMethod ?? "GET",
          url: this.__ftUrl ?? "",
          status: this.status || null,
          durationMs,
          size: typeof this.response === "string" ? this.response.length : null,
          initiator: "xhr",
          requestBody:
            cfg.requestBody && typeof body === "string"
              ? (redactBody(body, { maxBytes: cfg.maxBodyBytes ?? 16_384 }) ?? undefined)
              : undefined,
          responseBody:
            cfg.responseBody && typeof this.response === "string"
              ? (redactBody(this.response, { maxBytes: cfg.maxBodyBytes ?? 16_384 }) ?? undefined)
              : undefined,
          error: this.status === 0 ? "network error" : undefined,
        })
      })
      return origSend.call(this as XMLHttpRequest, body as BodyInit | null | undefined)
    }
  }

  return {
    start(config) {
      if (running) return
      if (config.enabled === false) return
      cfg = config
      buffer = new RingBuffer<NetworkEntry>(config.maxEntries ?? 50)
      if (typeof globalThis.fetch === "function") wrapFetch()
      if (typeof XMLHttpRequest !== "undefined") wrapXHR()
      running = true
    },
    snapshot() {
      return buffer?.drain() ?? []
    },
    peek() {
      return buffer?.peek() ?? []
    },
    clear() {
      buffer?.clear()
    },
    stop() {
      if (!running) return
      // Only unwrap if we're still the outermost wrapper. If something else
      // (Sentry, an APM agent) patched fetch after us, restoring our
      // pre-Repro original would silently rip their patch out too.
      if (originalFetch && globalThis.fetch === wrappedFetch) globalThis.fetch = originalFetch
      if (originalXHROpen) XMLHttpRequest.prototype.open = originalXHROpen
      if (originalXHRSend) XMLHttpRequest.prototype.send = originalXHRSend
      originalFetch = null
      wrappedFetch = null
      originalXHROpen = null
      originalXHRSend = null
      buffer = null
      running = false
    },
  }
}
