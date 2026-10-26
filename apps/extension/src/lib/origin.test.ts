import { describe, expect, test } from "bun:test"
import { findConfigForUrl, toOrigin } from "./origin"
import type { Config } from "../types"

const cfg = (origin: string, id = "1"): Config => ({
  id,
  label: "l",
  origin,
  projectKey: "rp_pk_aaaaaaaaaaaaaaaaaaaaaaaa",
  intakeEndpoint: "https://repro.example.com",
  relatedIssueField: true,
  createdAt: 0,
})

describe("toOrigin", () => {
  test("extracts scheme + host + port for https", () => {
    expect(toOrigin("https://staging.acme.com/some/path?x=1")).toBe("https://staging.acme.com")
  })
  test("extracts with explicit port", () => {
    expect(toOrigin("http://localhost:3000/foo")).toBe("http://localhost:3000")
  })
  test("returns null for chrome://", () => {
    expect(toOrigin("chrome://extensions")).toBeNull()
  })
  test("returns null for file://", () => {
    expect(toOrigin("file:///tmp/a.html")).toBeNull()
  })
  test("returns null for chrome-extension://", () => {
    expect(toOrigin("chrome-extension://abc/popup.html")).toBeNull()
  })
  test("returns null for unparseable", () => {
    expect(toOrigin("not a url")).toBeNull()
  })
})

describe("findConfigForUrl", () => {
  test("matches by exact origin", () => {
    const configs = [cfg("https://a.example"), cfg("https://b.example", "2")]
    expect(findConfigForUrl("https://b.example/path", configs)?.id).toBe("2")
  })
  test("returns undefined for non-matching origin", () => {
    const configs = [cfg("https://a.example")]
    expect(findConfigForUrl("https://c.example/path", configs)).toBeUndefined()
  })
  test("returns undefined for chrome:// URLs", () => {
    const configs = [cfg("https://a.example")]
    expect(findConfigForUrl("chrome://extensions", configs)).toBeUndefined()
  })
})
