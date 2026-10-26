import { describe, expect, test } from "bun:test"
import {
  MAX_PROXY_MESSAGE_BYTES,
  MAX_PROXY_RAW_BODY_BYTES,
  base64Length,
  maxRawBodyBytes,
} from "./proxy-limits"

const MB = 1024 * 1024

describe("base64Length", () => {
  test("pads every partial 3-byte group to a full 4-char quantum", () => {
    expect(base64Length(0)).toBe(0)
    expect(base64Length(1)).toBe(4)
    expect(base64Length(2)).toBe(4)
    expect(base64Length(3)).toBe(4)
    expect(base64Length(4)).toBe(8)
  })
  test("matches btoa for a real buffer", () => {
    const bytes = new Uint8Array(1001)
    let binary = ""
    for (const b of bytes) binary += String.fromCharCode(b)
    expect(base64Length(bytes.length)).toBe(btoa(binary).length)
  })
})

describe("maxRawBodyBytes", () => {
  test("is the largest raw size whose base64 form still fits the message limit", () => {
    for (const limit of [40 * MB, 40 * MB + 1, 40 * MB + 2, 40 * MB + 3, 1000, 1001]) {
      const max = maxRawBodyBytes(limit)
      expect(base64Length(max)).toBeLessThanOrEqual(limit)
      // One more 3-byte group would overflow.
      expect(base64Length(max + 3)).toBeGreaterThan(limit)
    }
  })
  test("default limit stays well under Chrome's 64 MB runtime.sendMessage cap", () => {
    expect(MAX_PROXY_MESSAGE_BYTES).toBeLessThanOrEqual(40 * MB)
    expect(MAX_PROXY_RAW_BODY_BYTES).toBe(maxRawBodyBytes(MAX_PROXY_MESSAGE_BYTES))
    // ~30 MB of raw upload — enough for a screenshot + 30 s replay + logs.
    expect(MAX_PROXY_RAW_BODY_BYTES).toBeGreaterThan(29 * MB)
    expect(MAX_PROXY_RAW_BODY_BYTES).toBeLessThan(31 * MB)
  })
})
