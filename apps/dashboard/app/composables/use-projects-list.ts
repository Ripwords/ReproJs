import type { ProjectDTO } from "@reprojs/shared"

const PROJECTS_LIST_KEY = "projects-list"

/**
 * The caller's projects (`GET /api/projects`). The sidebar, the top-bar
 * switcher, the command palette and the projects page all read it through
 * here, so they share one cache entry under one key. After creating,
 * renaming or deleting a project, call `refreshProjectsList()` and every one
 * of them updates.
 */
export function useProjectsList() {
  return useApi<ProjectDTO[]>("/api/projects", {
    key: PROJECTS_LIST_KEY,
    default: () => [],
  })
}

export function refreshProjectsList(): Promise<void> {
  return refreshNuxtData(PROJECTS_LIST_KEY)
}
