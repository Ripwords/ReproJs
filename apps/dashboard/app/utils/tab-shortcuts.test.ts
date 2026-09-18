import { describe, expect, test } from "bun:test"
import { tabForShortcut, tabShortcutKey } from "./tab-shortcuts"

const WEB = [
  "overview",
  "console",
  "network",
  "replay",
  "activity",
  "comments",
  "cookies",
  "attachments",
  "system",
  "raw",
].map((id) => ({ id }))

// Expo reports have no Replay or Cookies tab and, here, no Attachments.
const EXPO = ["overview", "console", "network", "activity", "comments", "system", "raw"].map(
  (id) => ({ id }),
)

describe("tabShortcutKey", () => {
  test("numbers tabs 1-9 then 0, and nothing past the tenth", () => {
    expect(tabShortcutKey(0)).toBe("1")
    expect(tabShortcutKey(8)).toBe("9")
    expect(tabShortcutKey(9)).toBe("0")
    expect(tabShortcutKey(10)).toBeNull()
  })
})

describe("tabForShortcut", () => {
  test("follows the rendered order, so Comments and Attachments are reachable", () => {
    expect(tabForShortcut(WEB, "6")).toBe("comments")
    expect(tabForShortcut(WEB, "8")).toBe("attachments")
    expect(tabForShortcut(WEB, "0")).toBe("raw")
  })

  test("never lands on a tab the report does not render", () => {
    expect(tabForShortcut(EXPO, "4")).toBe("activity")
    expect(tabForShortcut(EXPO, "7")).toBe("raw")
    expect(tabForShortcut(EXPO, "8")).toBeNull()
    expect(tabForShortcut(EXPO, "0")).toBeNull()
  })

  test("ignores keys that are not digits", () => {
    expect(tabForShortcut(WEB, "a")).toBeNull()
    expect(tabForShortcut(WEB, "Escape")).toBeNull()
  })
})
