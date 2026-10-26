import { describe, expect, test } from "bun:test"
import {
  PROJECT_KEY_PLACEHOLDER,
  buildInitSnippet,
  buildScriptSnippet,
  normalizeOrigin,
} from "./install-snippet"

const KEY = "rp_pk_abcdefghijklmnopqrstuvwx"

describe("normalizeOrigin", () => {
  test("strips a trailing slash so the SDK path is not //sdk", () => {
    expect(normalizeOrigin("https://repro.example.com/")).toBe("https://repro.example.com")
  })

  test("strips a trailing path so the snippet points at the origin", () => {
    expect(normalizeOrigin("https://repro.example.com/projects/abc")).toBe(
      "https://repro.example.com",
    )
  })

  test("leaves a bare origin alone, including a port", () => {
    expect(normalizeOrigin("http://localhost:3000")).toBe("http://localhost:3000")
  })

  test("falls back to the raw string when it is not a URL", () => {
    expect(normalizeOrigin("not a url")).toBe("not a url")
  })
})

describe("buildScriptSnippet", () => {
  test("uses the placeholder when the project has no key yet", () => {
    const code = buildScriptSnippet({ origin: "https://r.example", projectKey: null })
    expect(code).toContain(PROJECT_KEY_PLACEHOLDER)
    expect(code).not.toContain("null")
  })

  test("embeds the real key exactly once", () => {
    const code = buildScriptSnippet({ origin: "https://r.example", projectKey: KEY })
    expect(code.split(KEY).length - 1).toBe(1)
  })

  test("loads async and inits from onload so the inline init cannot race the bundle", () => {
    const code = buildScriptSnippet({ origin: "https://r.example", projectKey: KEY })
    expect(code).toMatch(/\basync\b/)
    expect(code).toContain('onload="Repro.init(')
    expect(code).not.toContain("<script>\n  Repro.init")
  })

  test("points both the bundle and the endpoint at the normalised origin", () => {
    const code = buildScriptSnippet({ origin: "https://r.example/", projectKey: KEY })
    expect(code).toContain('src="https://r.example/sdk/repro.iife.js"')
    expect(code).toContain("endpoint: 'https://r.example'")
    expect(code).not.toContain("https://r.example//")
  })

  test("closes the script tag so it can be pasted as-is", () => {
    const code = buildScriptSnippet({ origin: "https://r.example", projectKey: KEY })
    expect(code.trimEnd().endsWith("</script>")).toBe(true)
  })
})

describe("buildInitSnippet", () => {
  test("embeds the real key and endpoint", () => {
    const code = buildInitSnippet({ origin: "https://r.example/", projectKey: KEY })
    expect(code).toContain(`projectKey: "${KEY}"`)
    expect(code).toContain('endpoint: "https://r.example"')
  })

  test("uses the placeholder when the project has no key yet", () => {
    const code = buildInitSnippet({ origin: "https://r.example", projectKey: null })
    expect(code).toContain(PROJECT_KEY_PLACEHOLDER)
  })
})
