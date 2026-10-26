import { describe, expect, test } from "bun:test"
import { normalizeOrigin } from "./origins"

describe("normalizeOrigin", () => {
  test("strips path, query, fragment and trailing slash", () => {
    expect(normalizeOrigin("https://app.example.com/")).toBe("https://app.example.com")
    expect(normalizeOrigin("https://app.example.com/dashboard?x=1#top")).toBe(
      "https://app.example.com",
    )
  })

  test("lower-cases scheme and host but keeps a non-default port", () => {
    expect(normalizeOrigin("HTTPS://App.Example.COM")).toBe("https://app.example.com")
    expect(normalizeOrigin("http://Localhost:4000/x")).toBe("http://localhost:4000")
  })

  test("drops default ports and userinfo", () => {
    expect(normalizeOrigin("https://app.example.com:443")).toBe("https://app.example.com")
    expect(normalizeOrigin("http://app.example.com:80/")).toBe("http://app.example.com")
    expect(normalizeOrigin("https://user:pw@app.example.com")).toBe("https://app.example.com")
  })

  test("tolerates surrounding whitespace", () => {
    expect(normalizeOrigin("  https://app.example.com/  ")).toBe("https://app.example.com")
  })

  test("keeps chrome-extension origins intact", () => {
    expect(normalizeOrigin("chrome-extension://abcdefghijklmnop/popup.html")).toBe(
      "chrome-extension://abcdefghijklmnop",
    )
  })

  test("returns null for inputs without a usable origin", () => {
    expect(normalizeOrigin("app.example.com")).toBeNull()
    expect(normalizeOrigin("/relative/path")).toBeNull()
    expect(normalizeOrigin("file:///etc/passwd")).toBeNull()
    expect(normalizeOrigin("")).toBeNull()
    expect(normalizeOrigin("not a url")).toBeNull()
  })
})
