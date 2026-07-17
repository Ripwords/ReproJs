import { test, expect } from "bun:test"
import { formatBytes } from "./format"

test("formatBytes matches the widget's existing rendering", () => {
  expect(formatBytes(512)).toBe("512 B")
  expect(formatBytes(2048)).toBe("2 KB")
  expect(formatBytes(1_572_864)).toBe("1.5 MB")
})
