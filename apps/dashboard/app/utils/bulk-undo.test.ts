import { describe, expect, test } from "bun:test"
import { inverseBulkChange, type BulkUndoSnapshot } from "./bulk-undo"

const snap = (
  id: string,
  status: BulkUndoSnapshot["status"],
  assignees: string[] = [],
): BulkUndoSnapshot => ({ id, status, assignees })

describe("inverseBulkChange — status", () => {
  test("nothing selected means nothing to undo", () => {
    expect(inverseBulkChange([], { status: "closed" })).toEqual([])
  })

  test("reports that were already at the target status are not touched by undo", () => {
    const before = [snap("a", "closed"), snap("b", "open")]
    expect(inverseBulkChange(before, { status: "closed" })).toEqual([
      { reportIds: ["b"], status: "open" },
    ])
  })

  test("reports are grouped by the status they came from, one request per group", () => {
    const before = [
      snap("a", "open"),
      snap("b", "in_progress"),
      snap("c", "open"),
      snap("d", "resolved"),
    ]
    const inverse = inverseBulkChange(before, { status: "closed" })
    expect(inverse).toHaveLength(3)
    expect(inverse).toContainEqual({ reportIds: ["a", "c"], status: "open" })
    expect(inverse).toContainEqual({ reportIds: ["b"], status: "in_progress" })
    expect(inverse).toContainEqual({ reportIds: ["d"], status: "resolved" })
  })

  test("all reports from one status collapse into a single request", () => {
    const before = [snap("a", "open"), snap("b", "open")]
    expect(inverseBulkChange(before, { status: "resolved" })).toEqual([
      { reportIds: ["a", "b"], status: "open" },
    ])
  })
})

describe("inverseBulkChange — assignees", () => {
  test("unassigning is undone by restoring each report's previous assignees", () => {
    const before = [snap("a", "open", ["octocat"]), snap("b", "open", ["hubot", "octocat"])]
    const inverse = inverseBulkChange(before, { assignees: [] })
    expect(inverse).toHaveLength(2)
    expect(inverse).toContainEqual({ reportIds: ["a"], assignees: ["octocat"] })
    expect(inverse).toContainEqual({ reportIds: ["b"], assignees: ["hubot", "octocat"] })
  })

  test("reports that already had exactly the new assignees are skipped, order-insensitive", () => {
    const before = [snap("a", "open", ["octocat", "hubot"]), snap("b", "open", [])]
    expect(inverseBulkChange(before, { assignees: ["hubot", "octocat"] })).toEqual([
      { reportIds: ["b"], assignees: [] },
    ])
  })

  test("reports with the same previous assignee set share one request", () => {
    const before = [snap("a", "open", ["x"]), snap("b", "open", ["x"]), snap("c", "open", [])]
    const inverse = inverseBulkChange(before, { assignees: ["y"] })
    expect(inverse).toContainEqual({ reportIds: ["a", "b"], assignees: ["x"] })
    expect(inverse).toContainEqual({ reportIds: ["c"], assignees: [] })
  })
})

describe("inverseBulkChange — guards", () => {
  test("a patch with nothing to invert yields nothing", () => {
    expect(inverseBulkChange([snap("a", "open")], {})).toEqual([])
  })

  test("the input snapshots are not mutated", () => {
    const before = [snap("a", "open", ["x"])]
    const copy = structuredClone(before)
    inverseBulkChange(before, { status: "closed", assignees: [] })
    expect(before).toEqual(copy)
  })
})
