import { describe, expect, test } from "bun:test"
import { describeApiError } from "./api-error"

// Mirrors the FetchError ofetch/$fetch throws for a failed request (ofetch is
// not a direct dependency): `name` is "FetchError", `message` is the raw
// "[METHOD] "url": status text" line and `data` is the parsed body.
function fetchError(data: unknown, statusMessage?: string): Error {
  return Object.assign(new Error(`[PATCH] "/api/projects/p1": 409 ${statusMessage ?? ""}`), {
    name: "FetchError",
    data,
    statusCode: 409,
    statusMessage,
  })
}

describe("describeApiError", () => {
  test("uses the server's message instead of the raw fetch line", () => {
    const err = fetchError(
      { statusCode: 409, statusMessage: "Report is locked", message: "Report is locked" },
      "Report is locked",
    )
    expect(describeApiError(err)).toBe("Report is locked")
  })

  test("falls back to the body's statusMessage when message is missing", () => {
    expect(describeApiError(fetchError({ statusMessage: "Admin only" }))).toBe("Admin only")
  })

  test("falls back to the response statusMessage when the body is not JSON", () => {
    expect(describeApiError(fetchError("<html>bad gateway</html>", "Bad Gateway"))).toBe(
      "Bad Gateway",
    )
  })

  test("turns a Zod validation body into readable field messages", () => {
    const issues = [
      { code: "invalid_type", path: ["dailyReportCap"], message: "Expected number" },
      { code: "too_small", path: ["name"], message: "Too short" },
    ]
    const err = fetchError(
      {
        statusMessage: "Validation Error",
        message: JSON.stringify(issues, null, 2),
        data: { name: "ZodError" },
      },
      "Validation Error",
    )
    expect(describeApiError(err)).toBe("dailyReportCap: Expected number; name: Too short")
  })

  test("uses statusMessage when the message is unparseable JSON-ish text", () => {
    const err = fetchError({ statusMessage: "Validation Error", message: "[not json" })
    expect(describeApiError(err)).toBe("Validation Error")
  })

  test("never shows the raw fetch line for a network failure", () => {
    const err = Object.assign(
      new Error('[GET] "/api/projects": <no response> TypeError: Failed to fetch'),
      { name: "FetchError" },
    )
    expect(describeApiError(err)).toBe("Something went wrong. Please try again.")
  })

  test("reads useFetch/NuxtError-shaped errors (statusMessage + data)", () => {
    const err = Object.assign(new Error("Not found"), {
      statusCode: 404,
      statusMessage: "Project not found",
      data: { message: "Project not found" },
    })
    expect(describeApiError(err)).toBe("Project not found")
  })

  test("keeps the message of a plain client-side Error", () => {
    expect(describeApiError(new Error("Clipboard unavailable"))).toBe("Clipboard unavailable")
  })

  test("uses the caller's fallback for unknown values", () => {
    expect(describeApiError(undefined, "Could not load")).toBe("Could not load")
    expect(describeApiError("boom", "Could not load")).toBe("Could not load")
    expect(describeApiError(fetchError({ message: "   " }), "Could not load")).toBe(
      "Could not load",
    )
  })
})
