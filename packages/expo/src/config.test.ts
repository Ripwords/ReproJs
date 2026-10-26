import { test, expect } from "bun:test"
import { normalizeConfig } from "./config"

const VALID_KEY = "rp_pk_" + "a".repeat(24)
const VALID_URL = "https://example.com/api/intake"

test("normalizeConfig fills sensible defaults", () => {
  const cfg = normalizeConfig({ projectKey: VALID_KEY, intakeUrl: VALID_URL })
  expect(cfg).not.toBeNull()
  if (!cfg) return
  expect(cfg.collectors.console).toBe(true)
  expect(cfg.collectors.network.enabled).toBe(true)
  expect(cfg.queue.maxReports).toBe(5)
  expect(cfg.queue.maxBytes).toBe(10 * 1024 * 1024)
  expect(cfg.queue.backoffMs).toEqual([1000, 5000, 30000, 120000])
  expect(cfg.queue.submitTimeoutMs).toBe(60_000)
  expect(cfg.redact.headerDenylist).toContain("authorization")
})

test("normalizeConfig rejects malformed projectKey at runtime", () => {
  expect(() => normalizeConfig({ projectKey: "nope", intakeUrl: VALID_URL })).toThrow(/projectKey/)
})

test("normalizeConfig respects overrides", () => {
  const cfg = normalizeConfig({
    projectKey: VALID_KEY,
    intakeUrl: VALID_URL,
    queue: { maxReports: 3 },
    collectors: { network: { enabled: false } },
  })
  expect(cfg).not.toBeNull()
  if (!cfg) return
  expect(cfg.queue.maxReports).toBe(3)
  expect(cfg.queue.maxBytes).toBe(10 * 1024 * 1024)
  expect(cfg.collectors.network.enabled).toBe(false)
})

test("normalizeConfig returns null when projectKey is empty (silent disable)", () => {
  expect(normalizeConfig({ projectKey: "", intakeUrl: VALID_URL })).toBeNull()
})

test("normalizeConfig returns null when intakeUrl is empty (silent disable)", () => {
  expect(normalizeConfig({ projectKey: VALID_KEY, intakeUrl: "" })).toBeNull()
})
