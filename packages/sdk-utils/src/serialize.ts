// Shared, total value→string serializer for the web and mobile console
// collectors.
//
// This MUST NOT use TextEncoder/TextDecoder: Hermes (React Native) does not
// provide them, so anything reachable from the Expo SDK has to stay on plain
// string operations. Byte-accurate truncation belongs to the caller (the web
// collector layers `truncate` on top).

export const DEFAULT_STRING_REDACTORS: readonly RegExp[] = [
  /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.?[A-Za-z0-9_.+/=-]*/g,
  /gh[ps]_[A-Za-z0-9]{36,}/g,
  /xox[abp]-[A-Za-z0-9-]+/g,
  /AKIA[0-9A-Z]{16}/g,
  /Bearer\s+[A-Za-z0-9._~+/=-]+/gi,
]

export function scrubString(s: string, patterns: readonly RegExp[]): string {
  let out = s
  for (const re of patterns) out = out.replace(re, "REDACTED")
  return out
}

/**
 * Serialize an arbitrary console argument to a string.
 *
 * The contract is total: this ALWAYS returns a string, for every input.
 * That is load-bearing, not defensive styling — the intake API validates
 * the logs part with `LogsAttachment`, whose `console[].args` is
 * `z.array(z.string())`. A bare `JSON.stringify` returns the *value*
 * `undefined` for `undefined`, functions, and symbols; those become `null`
 * once the logs payload is JSON-serialized for the wire, the server answers
 * 400 "Invalid logs payload", and the whole report is lost.
 */
export function safeStringify(v: unknown): string {
  try {
    return stringifyInner(v)
  } catch {
    return "[Unserializable]"
  }
}

function stringifyInner(v: unknown): string {
  // The values JSON.stringify silently drops. These are the ones that caused
  // the outage, so they are handled first and explicitly.
  if (v === undefined) return "undefined"
  if (v === null) return "null"
  if (typeof v === "function") return "[Function]"
  if (typeof v === "symbol") return v.toString()
  if (typeof v === "number") {
    if (Number.isNaN(v)) return "NaN"
    if (!Number.isFinite(v)) return v > 0 ? "Infinity" : "-Infinity"
    return String(v)
  }
  if (typeof v === "string") return JSON.stringify(v)
  if (typeof v === "boolean" || typeof v === "bigint") return String(v)
  if (v instanceof Error) {
    return `${v.name}: ${v.message}${v.stack ? `\n${v.stack}` : ""}`
  }
  if (ArrayBuffer.isView(v)) {
    return `[${v.constructor.name} byteLength=${v.byteLength}]`
  }
  const seen = new WeakSet<object>()
  const out = JSON.stringify(v, (_key, value: unknown) => {
    if (typeof value === "object" && value !== null) {
      if (seen.has(value)) return "[Circular]"
      seen.add(value)
    }
    if (typeof value === "function") return "[Function]"
    if (typeof value === "bigint") return String(value)
    return value
  })
  // JSON.stringify can still return undefined here — e.g. an object whose
  // `toJSON()` returns undefined. Never let a non-string escape.
  return typeof out === "string" ? out : String(v)
}
