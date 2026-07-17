import { expect, test } from "bun:test"
import { parseRangeHeader } from "./range"

test("parses bytes=0-499", () => {
  expect(parseRangeHeader("bytes=0-499", 1000)).toEqual({ start: 0, end: 499 })
})
test("open-ended and suffix ranges", () => {
  expect(parseRangeHeader("bytes=500-", 1000)).toEqual({ start: 500, end: 999 })
  expect(parseRangeHeader("bytes=-200", 1000)).toEqual({ start: 800, end: 999 })
})
test("clamps end to size", () => {
  expect(parseRangeHeader("bytes=0-99999", 1000)).toEqual({ start: 0, end: 999 })
})
test("unsatisfiable start", () => {
  expect(parseRangeHeader("bytes=1000-", 1000)).toBe("unsatisfiable")
})
test("absent, malformed, multi-range → null", () => {
  expect(parseRangeHeader(undefined, 1000)).toBeNull()
  expect(parseRangeHeader("bytes=abc", 1000)).toBeNull()
  expect(parseRangeHeader("bytes=0-1,5-9", 1000)).toBeNull()
})
