import { test, expect, beforeEach, afterEach } from "bun:test"
import { createConsoleCollector } from "./console"

let originalConsole: typeof console

beforeEach(() => {
  originalConsole = { ...console }
})

afterEach(() => {
  Object.assign(console, originalConsole)
})

test("patches console.log and records the call", () => {
  const c = createConsoleCollector({ max: 10 })
  c.start()
  console.log("hi", 1)
  const entries = c.snapshot()
  expect(entries).toHaveLength(1)
  expect(entries[0]?.level).toBe("log")
  // Strings are JSON-quoted, matching the web collector's shared serializer
  // (see packages/ui/src/collectors/console.test.ts) so both SDKs hand the
  // dashboard identically-formatted console args.
  expect(entries[0]?.args).toEqual(['"hi"', "1"])
  c.stop()
})

test("captures stack on warn + error only", () => {
  const c = createConsoleCollector({ max: 10 })
  c.start()
  console.log("no stack")
  console.warn("with stack")
  console.error("with stack")
  const entries = c.snapshot()
  expect(entries.find((e) => e.level === "log")?.stack).toBeUndefined()
  expect(entries.find((e) => e.level === "warn")?.stack).toBeDefined()
  expect(entries.find((e) => e.level === "error")?.stack).toBeDefined()
  c.stop()
})

test("stop restores the original console functions", () => {
  const original = console.log
  const c = createConsoleCollector({ max: 10 })
  c.start()
  expect(console.log).not.toBe(original)
  c.stop()
  expect(console.log).toBe(original)
})

test("fails open if host code throws inside patched log", () => {
  const c = createConsoleCollector({ max: 10 })
  c.start()
  // Stub the ring push to throw — collector must still call through to the original.
  const originalPush = (c as unknown as { __buf: { push: (v: unknown) => void } }).__buf.push
  ;(c as unknown as { __buf: { push: (v: unknown) => void } }).__buf.push = () => {
    throw new Error("boom")
  }
  expect(() => console.log("x")).not.toThrow()
  ;(c as unknown as { __buf: { push: (v: unknown) => void } }).__buf.push = originalPush
  c.stop()
})

// Regression guard: the intake API validates the logs part with
// LogsAttachment (console[].args is z.array(z.string())). Before this fix
// `stringifyArg` returned the JS value `undefined` for undefined/function/
// symbol args, which JSON.stringify turns into `null` inside the args array.
// The server answered 400 "Invalid logs payload" and the Expo queue flusher
// classified 400 as non-retryable and DELETED the queued report — so the
// wizard reported success and the report silently never arrived.
test("logs payload survives the wire round-trip when args are not JSON-safe", async () => {
  const { LogsAttachment } = await import("@reprojs/shared")
  const c = createConsoleCollector({ max: 10 })
  c.start()
  console.log("value is", undefined)
  console.warn(() => {})
  console.error(Symbol("token"))
  console.log(Number.NaN, { nested: { deep: true } })
  c.stop()

  const payload = {
    version: 1 as const,
    console: c.snapshot(),
    network: [],
    breadcrumbs: [],
    config: {
      consoleMax: 200,
      networkMax: 100,
      breadcrumbsMax: 50,
      capturesBodies: false,
      capturesAllHeaders: false,
    },
  }
  // JSON.stringify is what the intake client does before the part hits the wire.
  const overTheWire: unknown = JSON.parse(JSON.stringify(payload))
  const result = LogsAttachment.safeParse(overTheWire)
  expect(result.success).toBe(true)
})

test("stringifies non-JSON-safe args to readable labels", () => {
  const c = createConsoleCollector({ max: 10 })
  c.start()
  console.log(undefined, () => {})
  c.stop()
  expect(c.snapshot()[0]?.args).toEqual(["undefined", "[Function]"])
})
