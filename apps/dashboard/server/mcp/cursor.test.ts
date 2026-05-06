import { describe, expect, it } from "bun:test"
import { decodeCursor, encodeCursor } from "./cursor"

describe("cursor", () => {
  it("roundtrips a Date + uuid", () => {
    const ts = new Date("2026-05-01T12:34:56.000Z")
    const id = "11111111-2222-3333-4444-555555555555"
    const encoded = encodeCursor({ createdAt: ts, id })
    expect(typeof encoded).toBe("string")
    const decoded = decodeCursor(encoded)
    expect(decoded?.createdAt.toISOString()).toBe("2026-05-01T12:34:56.000Z")
    expect(decoded?.id).toBe(id)
  })

  it("returns null for malformed cursors", () => {
    expect(decodeCursor("not-base64")).toBeNull()
    expect(decodeCursor("")).toBeNull()
    expect(decodeCursor(Buffer.from("bad-shape").toString("base64url"))).toBeNull()
  })
})
