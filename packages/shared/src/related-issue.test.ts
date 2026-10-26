import { describe, expect, test } from "bun:test"
import { parseRelatedIssueNumber } from "./related-issue"

describe("parseRelatedIssueNumber", () => {
  test.each([
    ["42", 42],
    ["#42", 42],
    ["  #42  ", 42],
    ["owner/repo#42", 42],
    ["https://github.com/owner/repo/issues/42", 42],
    ["https://github.com/owner/repo/issues/42/", 42],
    ["https://github.com/owner/repo/issues/42#issuecomment-123", 42],
    ["https://github.com/owner/repo/issues/42?foo=bar", 42],
    ["github.com/owner/repo/issues/42", 42],
    ["GH-7", 7],
  ])("accepts %p → %p", (input, expected) => {
    expect(parseRelatedIssueNumber(input)).toBe(expected)
  })

  test.each([
    [""],
    ["   "],
    ["abc"],
    ["0"],
    ["#0"],
    ["-5"],
    ["42abc"],
    ["4.2"],
    ["10000001"],
    ["https://github.com/owner/repo/pull/42"],
    ["https://github.com/owner/repo/issues/"],
    ["https://example.com/issues/42"],
    ["https://github.com/owner/repo/issues/42abc"],
    ["#42 #43"],
  ])("rejects %p", (input) => {
    expect(parseRelatedIssueNumber(input)).toBeNull()
  })
})
