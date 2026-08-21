import { test, expect } from "bun:test"
import { safeStringify, scrubString, DEFAULT_STRING_REDACTORS } from "./serialize"

// Regression guard for the iOS/Expo intake outage: a serializer that returns
// anything other than a string lands as `null` in the JSON-serialized logs
// payload, which the intake API rejects with 400 "Invalid logs payload".
test("safeStringify always returns a string, for every input shape", () => {
  const inputs: unknown[] = [
    undefined,
    null,
    () => {},
    Math.max, // a native function stringifies differently from a user one
    Symbol("s"),
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    0,
    "",
    "hi",
    true,
    10n,
    new Error("boom"),
    new Uint8Array([1, 2, 3]),
    { a: 1 },
    [1, undefined, () => {}],
    new Date(0),
    new Map([["a", 1]]),
    new Set([1]),
  ]
  for (const v of inputs) {
    expect(typeof safeStringify(v)).toBe("string")
  }
})

test("safeStringify survives circular references", () => {
  const a: Record<string, unknown> = { name: "a" }
  a.self = a
  expect(typeof safeStringify(a)).toBe("string")
  expect(safeStringify(a)).toContain("[Circular]")
})

test("safeStringify labels the values JSON.stringify drops", () => {
  expect(safeStringify(undefined)).toBe("undefined")
  expect(safeStringify(() => {})).toBe("[Function]")
  expect(safeStringify(Symbol("tok"))).toContain("Symbol")
  expect(safeStringify(Number.NaN)).toBe("NaN")
})

test("scrubString redacts known secret shapes", () => {
  const out = scrubString("Bearer abc123def456", DEFAULT_STRING_REDACTORS)
  expect(out).not.toContain("abc123def456")
  expect(out).toContain("REDACTED")
})
