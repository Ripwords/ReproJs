import { describe, expect, test } from "bun:test"
import { parseInboxQuery } from "../composables/use-inbox-query"
import { QUICK_VIEWS, activeQuickView, quickViewPatch } from "./inbox-quick-views"

describe("quickViewPatch", () => {
  test("every view sets all three triage facets so switching views never stacks filters", () => {
    for (const v of QUICK_VIEWS) {
      const patch = quickViewPatch(v.id)
      expect(Object.keys(patch).toSorted()).toEqual(["assignee", "priority", "status"])
    }
  })

  test("open is only the open status, nothing else", () => {
    expect(quickViewPatch("open")).toEqual({ status: ["open"], assignee: [], priority: [] })
  })

  test("mine uses the server's `me` token on active statuses", () => {
    expect(quickViewPatch("mine")).toEqual({
      status: ["open", "in_progress"],
      assignee: ["me"],
      priority: [],
    })
  })

  test("unassigned uses the server's `unassigned` token on active statuses", () => {
    expect(quickViewPatch("unassigned").assignee).toEqual(["unassigned"])
  })

  test("urgent filters priority on active statuses", () => {
    expect(quickViewPatch("urgent")).toEqual({
      status: ["open", "in_progress"],
      assignee: [],
      priority: ["urgent"],
    })
  })
})

describe("activeQuickView", () => {
  test("nothing matches the All state", () => {
    expect(activeQuickView(parseInboxQuery({}))).toBeNull()
  })

  test("an extra facet on top of a view means no view is active", () => {
    expect(activeQuickView(parseInboxQuery({ status: "open", priority: "high" }))).toBeNull()
  })

  test("a view's own patch round-trips to that view", () => {
    for (const v of QUICK_VIEWS) {
      const q = { ...parseInboxQuery({}), ...quickViewPatch(v.id) }
      expect(activeQuickView(q)).toBe(v.id)
    }
  })

  test("status order in the URL does not matter", () => {
    const q = parseInboxQuery({ status: "in_progress,open", assignee: "me" })
    expect(activeQuickView(q)).toBe("mine")
  })

  test("search, labels, source, sort and page do not affect which view is active", () => {
    const q = parseInboxQuery({
      status: "open",
      q: "crash",
      tag: "ui",
      source: "web",
      sort: "oldest",
      page: "3",
    })
    expect(activeQuickView(q)).toBe("open")
  })

  test("a specific login is not `mine`", () => {
    const q = parseInboxQuery({ status: "open,in_progress", assignee: "octocat" })
    expect(activeQuickView(q)).toBeNull()
  })
})
