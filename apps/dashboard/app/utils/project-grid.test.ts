import { describe, expect, test } from "bun:test"
import type { ProjectDTO, ProjectStatsDTO } from "@reprojs/shared"
import { buildProjectCards, emptyStats, pageOf } from "./project-grid"

function project(id: string): ProjectDTO {
  return {
    id,
    name: id,
    createdBy: "u",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    effectiveRole: "owner",
    publicKey: null,
    allowedOrigins: [],
    dailyReportCap: 100,
    replayEnabled: true,
    shareLinksEnabled: true,
    shareRetentionDays: 7,
  }
}

function stats(projectId: string, lastReportAt: string | null): ProjectStatsDTO {
  return { ...emptyStats(projectId), lastReportAt }
}

describe("buildProjectCards", () => {
  test("orders by latest report, idle projects last in their original order", () => {
    const cards = buildProjectCards(
      [project("idle-1"), project("busy-old"), project("idle-2"), project("busy-new")],
      [stats("busy-old", "2026-10-01T00:00:00Z"), stats("busy-new", "2026-10-20T00:00:00Z")],
    )
    expect(cards.map((c) => c.project.id)).toEqual(["busy-new", "busy-old", "idle-1", "idle-2"])
  })

  test("a project missing from the stats answer gets zeroed numbers, not a crash", () => {
    const [card] = buildProjectCards([project("p")], [])
    expect(card?.stats).toEqual(emptyStats("p"))
  })
})

describe("pageOf", () => {
  const items = Array.from({ length: 25 }, (_, i) => i)

  test("slices 1-based pages of the given size", () => {
    expect(pageOf(items, 1, 12).items).toEqual(items.slice(0, 12))
    expect(pageOf(items, 3, 12)).toEqual({ items: [24], page: 3, pageCount: 3 })
  })

  test("clamps pages that fell off the end after a delete, and never below 1", () => {
    expect(pageOf(items, 9, 12).page).toBe(3)
    expect(pageOf([], 4, 12)).toEqual({ items: [], page: 1, pageCount: 1 })
  })
})
