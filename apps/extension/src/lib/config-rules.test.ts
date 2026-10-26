import { describe, expect, test } from "bun:test"
import { canAddConfig, permissionsToRevoke } from "./config-rules"
import type { Config } from "../types"

const cfg = (
  id: string,
  origin: string,
  intakeEndpoint = "https://repro.example.com/dashboard",
): Config => ({
  id,
  label: id,
  origin,
  projectKey: "rp_pk_aaaaaaaaaaaaaaaaaaaaaaaa",
  intakeEndpoint,
  createdAt: 0,
})

describe("permissionsToRevoke", () => {
  test("revokes the page origin when nothing else uses it", () => {
    const removed = cfg("a", "https://a.example")
    const remaining = [cfg("b", "https://b.example")]
    expect(permissionsToRevoke(removed, remaining)).toEqual(["https://a.example"])
  })

  test("keeps the page origin when another config shares it", () => {
    const removed = cfg("a", "https://a.example")
    const remaining = [cfg("a2", "https://a.example"), cfg("b", "https://b.example")]
    expect(permissionsToRevoke(removed, remaining)).toEqual([])
  })

  test("keeps the page origin when another config posts to it as its intake host", () => {
    // Tester runs the dashboard itself through the extension; a second
    // config on another site uploads to that same dashboard.
    const removed = cfg("dash", "https://repro.example.com")
    const remaining = [cfg("site", "https://site.example", "https://repro.example.com")]
    expect(permissionsToRevoke(removed, remaining)).toEqual([])
  })

  test("never revokes the intake origin", () => {
    const removed = cfg("a", "https://a.example", "https://repro.example.com")
    expect(permissionsToRevoke(removed, [])).toEqual(["https://a.example"])
  })
})

describe("canAddConfig", () => {
  test("rejects a second config for an origin that already has one", () => {
    const result = canAddConfig("https://a.example", [cfg("a", "https://a.example")])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain("https://a.example")
  })

  test("accepts a new origin", () => {
    expect(canAddConfig("https://c.example", [cfg("a", "https://a.example")])).toEqual({ ok: true })
  })

  test("treats origins as exact strings — a different port is a different origin", () => {
    expect(canAddConfig("http://localhost:3001", [cfg("a", "http://localhost:3000")])).toEqual({
      ok: true,
    })
  })
})
