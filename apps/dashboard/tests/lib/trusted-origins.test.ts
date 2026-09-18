import { describe, expect, test } from "bun:test"
import { parseTrustedOrigins } from "../../server/lib/trusted-origins"

describe("parseTrustedOrigins", () => {
  test("unset means no extra origins, so the default stays BETTER_AUTH_URL alone", () => {
    expect(parseTrustedOrigins(undefined)).toEqual([])
    expect(parseTrustedOrigins("")).toEqual([])
  })

  test("splits a comma list and trims each entry", () => {
    // better-auth's own reading of this variable doesn't trim, so
    // "https://a.example.com, https://b.example.com" silently failed to
    // match the second origin.
    expect(parseTrustedOrigins("https://a.example.com, https://b.example.com ,")).toEqual([
      "https://a.example.com",
      "https://b.example.com",
    ])
  })

  test("normalises a full URL down to its origin", () => {
    expect(parseTrustedOrigins("https://feedback.example.com/")).toEqual([
      "https://feedback.example.com",
    ])
  })

  test("keeps better-auth wildcard patterns as written", () => {
    expect(parseTrustedOrigins("https://*.example.com")).toEqual(["https://*.example.com"])
  })

  test("rejects an entry with no scheme, which would never match a browser Origin", () => {
    expect(() => parseTrustedOrigins("feedback.example.com")).toThrow(/feedback\.example\.com/)
  })
})
