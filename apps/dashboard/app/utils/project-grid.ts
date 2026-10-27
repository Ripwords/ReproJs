import type { ProjectDTO, ProjectStatsDTO } from "@reprojs/shared"

export const PROJECTS_PAGE_SIZE = 12

/** A project card's worth of data: the project plus its numbers (zeroed when the stats call has not answered yet). */
export interface ProjectCard {
  project: ProjectDTO
  stats: ProjectStatsDTO
}

export function emptyStats(projectId: string): ProjectStatsDTO {
  return {
    projectId,
    openCount: 0,
    inProgressCount: 0,
    newLast7Count: 0,
    totalCount: 0,
    lastReportAt: null,
    github: null,
  }
}

/**
 * Pair each project with its stats. Projects are ordered by the latest
 * report first so the busiest ones lead the grid; projects that never
 * received a report keep their creation order at the end.
 */
export function buildProjectCards(
  projects: readonly ProjectDTO[],
  stats: readonly ProjectStatsDTO[],
): ProjectCard[] {
  const byId = new Map(stats.map((s) => [s.projectId, s]))
  return projects
    .map((project) => ({ project, stats: byId.get(project.id) ?? emptyStats(project.id) }))
    .toSorted((a, b) => {
      const ta = a.stats.lastReportAt ? Date.parse(a.stats.lastReportAt) : 0
      const tb = b.stats.lastReportAt ? Date.parse(b.stats.lastReportAt) : 0
      return tb - ta
    })
}

/** Slice for one page (1-based). An out-of-range page clamps to the last page. */
export function pageOf<T>(
  items: readonly T[],
  page: number,
  size = PROJECTS_PAGE_SIZE,
): {
  items: T[]
  page: number
  pageCount: number
} {
  const pageCount = Math.max(1, Math.ceil(items.length / size))
  const current = Math.min(Math.max(1, page), pageCount)
  const start = (current - 1) * size
  return { items: items.slice(start, start + size), page: current, pageCount }
}
