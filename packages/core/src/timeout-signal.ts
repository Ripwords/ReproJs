// AbortSignal.timeout() is missing on Safari < 16 and older WebViews. Build
// the same thing from AbortController + setTimeout there so a report POST
// still gets a deadline instead of a TypeError before fetch is even called.
//
// Aborts with a DOMException named "TimeoutError" (matching the native API)
// so callers can map it to a user-facing message.
export function timeoutSignal(ms: number): AbortSignal {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(ms)
  }
  const controller = new AbortController()
  setTimeout(() => controller.abort(timeoutReason()), ms)
  return controller.signal
}

function timeoutReason(): unknown {
  try {
    return new DOMException("The operation timed out.", "TimeoutError")
  } catch {
    return new Error("The operation timed out.")
  }
}

/** True when a fetch rejection came from the request's timeout/abort signal. */
export function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false
  const name = (err as { name?: unknown }).name
  return name === "AbortError" || name === "TimeoutError"
}
