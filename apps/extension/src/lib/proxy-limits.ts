// chrome.runtime.sendMessage serializes the whole message to JSON and Chrome
// rejects anything above 64 MB ("Message length exceeded maximum allowed
// length"). Request bodies ride through it base64-encoded, which inflates
// them by 4/3, so the raw-body ceiling has to be derived from the message
// ceiling. We stop at 40 MB of serialized body to leave headroom for the
// JSON envelope and for Chrome's own per-process memory pressure.

export const MAX_PROXY_MESSAGE_BYTES = 40 * 1024 * 1024

/** Characters produced by base64-encoding `rawBytes` bytes (with padding). */
export function base64Length(rawBytes: number): number {
  return Math.ceil(rawBytes / 3) * 4
}

/** Largest raw byte count whose base64 form fits inside `limit` characters. */
export function maxRawBodyBytes(limit: number = MAX_PROXY_MESSAGE_BYTES): number {
  return Math.floor(limit / 4) * 3
}

export const MAX_PROXY_RAW_BODY_BYTES = maxRawBodyBytes()
