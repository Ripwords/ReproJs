/**
 * Turn whatever a failed `$fetch` / `useFetch` call threw into text a person
 * can read in a toast or inline error.
 *
 * `$fetch` rejects with a FetchError whose `message` is the raw request line
 * (`[PATCH] "/api/…": 409 …`), which is noise to a user. The server's own
 * explanation lives in the parsed body (`data.message` / `data.statusMessage`,
 * as produced by h3's `createError`) or on the error's `statusMessage`.
 * Validation failures from `readValidatedBody` put a JSON-encoded Zod issue
 * list in `message`; those are flattened to "field: problem" pairs.
 */
export function describeApiError(
  err: unknown,
  fallback = "Something went wrong. Please try again.",
): string {
  if (typeof err !== "object" || err === null) return fallback

  const { data, statusMessage, name } = err as {
    data?: unknown
    statusMessage?: unknown
    name?: unknown
  }

  if (typeof data === "object" && data !== null) {
    const body = data as { message?: unknown; statusMessage?: unknown }
    const fromMessage = readServerMessage(body.message)
    if (fromMessage) return fromMessage
    if (isText(body.statusMessage)) return body.statusMessage.trim()
  }
  if (isText(statusMessage)) return statusMessage.trim()

  // A FetchError with no usable body is a network/proxy failure; its message
  // is the raw request line, so don't surface it.
  if (name !== "FetchError" && err instanceof Error && isText(err.message)) {
    return err.message.trim()
  }
  return fallback
}

function isText(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0
}

function readServerMessage(message: unknown): string | null {
  if (!isText(message)) return null
  const text = message.trim()
  if (!text.startsWith("[")) return text
  // Zod issue list serialised by h3's readValidatedBody.
  try {
    const issues: unknown = JSON.parse(text)
    if (!Array.isArray(issues)) return null
    const parts = issues.flatMap((issue: unknown) => {
      if (typeof issue !== "object" || issue === null) return []
      const { path, message: msg } = issue as { path?: unknown; message?: unknown }
      if (!isText(msg)) return []
      const field = Array.isArray(path) && path.length > 0 ? path.join(".") : ""
      return [field ? `${field}: ${msg}` : msg]
    })
    return parts.length > 0 ? parts.join("; ") : null
  } catch {
    return null
  }
}
