import type { ProjectRole } from "@reprojs/shared"

// Mirrors ROLE_RANK in server/lib/permissions.ts, which is the source of
// truth. UI gating only hides controls the server would reject anyway.
const ROLE_RANK: Record<ProjectRole, number> = { viewer: 1, manager: 2, developer: 3, owner: 4 }

function isProjectRole(role: string): role is ProjectRole {
  return Object.hasOwn(ROLE_RANK, role)
}

/**
 * True when `role` (the caller's effective project role, as returned by
 * `/api/projects/:id` or `/api/projects/:id/me`) ranks at or above `min`.
 * An unknown or not-yet-loaded role is denied.
 */
export function hasProjectRole(role: string | null | undefined, min: ProjectRole): boolean {
  if (!role || !isProjectRole(role)) return false
  return ROLE_RANK[role] >= ROLE_RANK[min]
}
