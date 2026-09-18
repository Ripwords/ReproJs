import { describe, expect, test } from "bun:test"
import { buildSortClause, diffTags, resolveAssigneeFilter } from "../../server/lib/inbox-query"

describe("diffTags", () => {
  test("returns added-only when tags are appended", () => {
    expect(diffTags(["a", "b"], ["a", "b", "c"])).toEqual({ added: ["c"], removed: [] })
  })
  test("returns removed-only when tags are dropped", () => {
    expect(diffTags(["a", "b"], ["a"])).toEqual({ added: [], removed: ["b"] })
  })
  test("returns both when tags are swapped", () => {
    expect(diffTags(["a", "b"], ["a", "c"])).toEqual({ added: ["c"], removed: ["b"] })
  })
  test("ignores order-only changes", () => {
    expect(diffTags(["a", "b"], ["b", "a"])).toEqual({ added: [], removed: [] })
  })
  test("deduplicates so the same tag added twice is one entry", () => {
    expect(diffTags([], ["a", "a", "b"])).toEqual({ added: ["a", "b"], removed: [] })
  })
  test("empty → empty returns nothing", () => {
    expect(diffTags([], [])).toEqual({ added: [], removed: [] })
  })
})

describe("resolveAssigneeFilter", () => {
  test("'me' resolves to the session user's linked github login", () => {
    expect(resolveAssigneeFilter(["me"], "alice")).toEqual([{ type: "login", login: "alice" }])
  })
  test("'me' is dropped when the session user has no linked github identity", () => {
    expect(resolveAssigneeFilter(["me"], null)).toEqual([])
  })
  test("'unassigned' returns { type: 'null' }", () => {
    expect(resolveAssigneeFilter(["unassigned"], "alice")).toEqual([{ type: "null" }])
  })
  test("plain logins pass through", () => {
    expect(resolveAssigneeFilter(["bob", "carol"], "alice")).toEqual([
      { type: "login", login: "bob" },
      { type: "login", login: "carol" },
    ])
  })
  test("mixed tokens preserve order", () => {
    expect(resolveAssigneeFilter(["me", "unassigned", "bob"], "alice")).toEqual([
      { type: "login", login: "alice" },
      { type: "null" },
      { type: "login", login: "bob" },
    ])
  })
  test("empty array returns empty", () => {
    expect(resolveAssigneeFilter([], "alice")).toEqual([])
  })
  test("dedupes identical tokens", () => {
    expect(resolveAssigneeFilter(["me", "me"], "alice")).toEqual([
      { type: "login", login: "alice" },
    ])
  })
})

describe("buildSortClause", () => {
  // Every sort ends with an id tie-break so offset pagination is stable.
  test("newest → created_at + id tiebreak", () => {
    const out = buildSortClause("newest")
    expect(out.length).toBe(2)
  })
  test("oldest → created_at + id tiebreak", () => {
    const out = buildSortClause("oldest")
    expect(out.length).toBe(2)
  })
  test("updated → updated_at + id tiebreak", () => {
    const out = buildSortClause("updated")
    expect(out.length).toBe(2)
  })
  test("priority → CASE + created_at + id tiebreak (3 expressions)", () => {
    const out = buildSortClause("priority")
    expect(out.length).toBe(3)
  })
  test("unknown key defaults to newest", () => {
    const out = buildSortClause("garbage")
    expect(out.length).toBe(2)
  })
})
