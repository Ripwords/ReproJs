import { describe, expect, test } from "bun:test"
import { AdminOverviewDTO } from "./admin"

const base = {
  counts: {
    total: 0,
    byStatus: { open: 0, in_progress: 0, resolved: 0, closed: 0 },
    byPriority: { low: 0, normal: 0, high: 0, urgent: 0 },
    last7Days: 0,
  },
  projects: { total: 0, withGithub: 0 },
  recentReports: [],
  recentEvents: [],
  perProject: [],
}

describe("AdminOverviewDTO.volume", () => {
  test("accepts a zero-filled volume series", () => {
    const parsed = AdminOverviewDTO.parse({
      ...base,
      volume: [
        { date: "2026-05-18", count: 3 },
        { date: "2026-05-19", count: 0 },
      ],
    })
    expect(parsed.volume).toEqual([
      { date: "2026-05-18", count: 3 },
      { date: "2026-05-19", count: 0 },
    ])
  })

  test("rejects a payload missing volume", () => {
    expect(() => AdminOverviewDTO.parse(base)).toThrow()
  })

  test("rejects a non-integer count", () => {
    expect(() =>
      AdminOverviewDTO.parse({ ...base, volume: [{ date: "2026-05-19", count: 1.5 }] }),
    ).toThrow()
  })
})
