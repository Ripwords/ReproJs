import { test, expect } from "bun:test"
import { MEDIA_LIMITS, validateMediaSelection } from "./validate"

test("accepts up to 3 items within per-kind caps", () => {
  const r = validateMediaSelection([
    { kind: "image", sizeBytes: 5 * 1024 * 1024 },
    { kind: "video", sizeBytes: 90 * 1024 * 1024 },
  ])
  expect(r.ok).toBe(true)
  expect(r.errors).toHaveLength(0)
})

test("rejects a 4th item", () => {
  const items = Array.from({ length: 4 }, () => ({ kind: "image" as const, sizeBytes: 1024 }))
  const r = validateMediaSelection(items)
  expect(r.ok).toBe(false)
  expect(r.errors[0]).toContain(String(MEDIA_LIMITS.maxCount))
})

test("rejects oversize video and oversize image with distinct messages", () => {
  expect(validateMediaSelection([{ kind: "video", sizeBytes: 101 * 1024 * 1024 }]).ok).toBe(false)
  expect(validateMediaSelection([{ kind: "image", sizeBytes: 11 * 1024 * 1024 }]).ok).toBe(false)
})
