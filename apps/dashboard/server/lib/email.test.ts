import { describe, expect, test } from "bun:test"
import { firstLinkIn } from "./email"

describe("firstLinkIn (console mail provider)", () => {
  test("prints the link as a browser would follow it, not HTML-escaped", () => {
    // Templates escape `&` in href attributes. Printed as-is, a pasted link
    // arrives with `amp;callbackURL=…` and every parameter after the first
    // is lost.
    const html = `<a href="http://localhost:3000/auth/verify?token=abc&amp;callbackURL=%2F&amp;errorCallbackURL=%2Fauth%2Fsign-in">Sign in</a>`
    expect(firstLinkIn(html)).toBe(
      "http://localhost:3000/auth/verify?token=abc&callbackURL=%2F&errorCallbackURL=%2Fauth%2Fsign-in",
    )
  })

  test("returns null when the email has no link", () => {
    expect(firstLinkIn("<p>No links here.</p>")).toBeNull()
  })
})
