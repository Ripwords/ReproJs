import { describe, expect, test } from "bun:test"
import { formatAbsolute, formatRelative } from "./date-format"

const NOW = Date.parse("2026-09-18T12:00:00.000Z")
const ago = (ms: number) => new Date(NOW - ms).toISOString()
const ahead = (ms: number) => new Date(NOW + ms).toISOString()
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

describe("formatRelative", () => {
  test("empty or unparseable input renders nothing", () => {
    expect(formatRelative(null, { now: NOW })).toBe("")
    expect(formatRelative(undefined, { now: NOW })).toBe("")
    expect(formatRelative("", { now: NOW })).toBe("")
    expect(formatRelative("not a date", { now: NOW })).toBe("")
  })

  test("past times count up through minutes, hours and days", () => {
    expect(formatRelative(ago(20_000), { now: NOW })).toBe("just now")
    expect(formatRelative(ago(5 * MIN), { now: NOW })).toBe("5m ago")
    expect(formatRelative(ago(3 * HOUR), { now: NOW })).toBe("3h ago")
    expect(formatRelative(ago(2 * DAY), { now: NOW })).toBe("2d ago")
    expect(formatRelative(ago(29 * DAY), { now: NOW })).toBe("29d ago")
  })

  test("long spans switch to months, then years, instead of hundreds of days", () => {
    expect(formatRelative(ago(45 * DAY), { now: NOW })).toBe("1mo ago")
    expect(formatRelative(ago(200 * DAY), { now: NOW })).toBe("6mo ago")
    expect(formatRelative(ago(800 * DAY), { now: NOW })).toBe("2y ago")
  })

  test("compact drops the suffix for dense table columns", () => {
    expect(formatRelative(ago(20_000), { now: NOW, compact: true })).toBe("now")
    expect(formatRelative(ago(5 * MIN), { now: NOW, compact: true })).toBe("5m")
    expect(formatRelative(ago(2 * DAY), { now: NOW, compact: true })).toBe("2d")
  })

  test("future times read as 'in …', e.g. an invitation expiry", () => {
    expect(formatRelative(ahead(20_000), { now: NOW })).toBe("in under a minute")
    expect(formatRelative(ahead(5 * MIN), { now: NOW })).toBe("in 5m")
    expect(formatRelative(ahead(6 * DAY + HOUR), { now: NOW })).toBe("in 6d")
  })

  test("accepts Date objects as well as ISO strings", () => {
    expect(formatRelative(new Date(NOW - 3 * HOUR), { now: NOW })).toBe("3h ago")
  })
})

describe("formatAbsolute", () => {
  test("renders date and time in the given locale and zone", () => {
    // The joiner between date and time (", " vs " at ") varies by ICU version.
    const text = formatAbsolute("2026-09-18T12:05:00.000Z", { locale: "en-US", timeZone: "UTC" })
    expect(text).toStartWith("Sep 18, 2026")
    expect(text).toEndWith("12:05 PM")
  })

  test("empty or unparseable input renders nothing", () => {
    expect(formatAbsolute(null)).toBe("")
    expect(formatAbsolute("nope")).toBe("")
  })
})
