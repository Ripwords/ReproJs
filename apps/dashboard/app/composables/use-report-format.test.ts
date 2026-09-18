import { describe, expect, test } from "bun:test"
import { REPORT_PRIORITIES, REPORT_STATUSES, priorityLabel, statusLabel } from "./use-report-format"

describe("report status/priority labels", () => {
  test("statuses are sentence case", () => {
    expect(REPORT_STATUSES.map(statusLabel)).toEqual(["Open", "In progress", "Resolved", "Closed"])
  })

  test("priorities are listed most urgent first", () => {
    expect(REPORT_PRIORITIES.map(priorityLabel)).toEqual(["Urgent", "High", "Normal", "Low"])
  })

  test("unknown values fall through unchanged", () => {
    expect(statusLabel("archived")).toBe("archived")
    expect(priorityLabel(null)).toBe("—")
  })
})
