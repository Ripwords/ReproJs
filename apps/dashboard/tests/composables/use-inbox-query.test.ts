import { describe, expect, test } from "bun:test"
import {
  INBOX_PAGE_SIZE,
  inboxApiQuery,
  inboxLocationQuery,
  parseInboxQuery,
} from "../../app/composables/use-inbox-query"

describe("parseInboxQuery", () => {
  test("defaults to page 1", () => {
    expect(parseInboxQuery({}).page).toBe(1)
  })

  test("reads page from the URL", () => {
    expect(parseInboxQuery({ page: "3" }).page).toBe(3)
  })

  test("falls back to page 1 for junk or non-positive values", () => {
    expect(parseInboxQuery({ page: "abc" }).page).toBe(1)
    expect(parseInboxQuery({ page: "0" }).page).toBe(1)
    expect(parseInboxQuery({ page: "-2" }).page).toBe(1)
    expect(parseInboxQuery({ page: "2.5" }).page).toBe(1)
  })
})

describe("inboxApiQuery", () => {
  test("turns the page into an offset of whole pages", () => {
    const api = inboxApiQuery(parseInboxQuery({ page: "3" }))
    expect(api).toContain(`limit=${INBOX_PAGE_SIZE}`)
    expect(api).toContain(`offset=${2 * INBOX_PAGE_SIZE}`)
  })

  test("page 1 is offset 0", () => {
    expect(inboxApiQuery(parseInboxQuery({}))).toContain("offset=0")
  })
})

describe("inboxLocationQuery", () => {
  const onPage3 = parseInboxQuery({ page: "3", status: "open" })

  test("changing the page keeps the filters", () => {
    expect(inboxLocationQuery(onPage3, { page: 4 })).toEqual({ status: "open", page: "4" })
  })

  test("page 1 is left out of the URL", () => {
    expect(inboxLocationQuery(onPage3, { page: 1 })).toEqual({ status: "open" })
  })

  test.each([
    ["status", { status: ["resolved"] }],
    ["priority", { priority: ["high"] }],
    ["tag", { tag: ["ui"] }],
    ["assignee", { assignee: ["octocat"] }],
    ["source", { source: ["web"] }],
    ["search", { q: "crash" }],
    ["sort", { sort: "oldest" as const }],
  ])("changing %s goes back to page 1", (_name, patch) => {
    expect(inboxLocationQuery(onPage3, patch).page).toBeUndefined()
  })
})
