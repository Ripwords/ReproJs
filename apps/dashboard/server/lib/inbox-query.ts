import { asc, desc, sql, type SQL } from "drizzle-orm"
import { reports } from "../db/schema"

export interface TagDiff {
  added: string[]
  removed: string[]
}

export function diffTags(oldTags: readonly string[], newTags: readonly string[]): TagDiff {
  const oldSet = new Set(oldTags)
  const newSet = new Set(newTags)
  const added: string[] = []
  const removed: string[] = []
  for (const t of newSet) if (!oldSet.has(t)) added.push(t)
  for (const t of oldSet) if (!newSet.has(t)) removed.push(t)
  return { added, removed }
}

// Assignees are github logins now — "me" resolves to the session user's
// linked github login (or drops if they haven't linked). The caller is
// responsible for looking that login up before invoking this function so
// the query planner stays sync.
export type AssigneeFilter = { type: "login"; login: string } | { type: "null" }

export function resolveAssigneeFilter(
  tokens: readonly string[],
  sessionGithubLogin: string | null,
): AssigneeFilter[] {
  const seen = new Set<string>()
  const out: AssigneeFilter[] = []
  for (const t of tokens) {
    let resolved: AssigneeFilter | null
    if (t === "me") {
      // If the session user hasn't linked a github identity, their "assigned
      // to me" filter silently matches nothing — same effect as not having
      // any assigned reports.
      resolved = sessionGithubLogin ? { type: "login", login: sessionGithubLogin } : null
    } else if (t === "unassigned") {
      resolved = { type: "null" }
    } else {
      resolved = { type: "login", login: t }
    }
    if (!resolved) continue
    const key = resolved.type === "null" ? "null" : `l:${resolved.login}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(resolved)
  }
  return out
}

export type SortKey = "newest" | "oldest" | "priority" | "updated"

export function buildSortClause(sort: string): SQL[] {
  // `reports.id` is the final key for every sort so rows that tie on the
  // leading keys (e.g. a batch sharing one `created_at`) keep a stable order
  // across LIMIT/OFFSET pages instead of repeating or skipping rows.
  const tieBreak = desc(reports.id)
  switch (sort) {
    case "oldest":
      return [asc(reports.createdAt), tieBreak]
    case "updated":
      return [desc(reports.updatedAt), tieBreak]
    case "priority":
      return [
        sql`case ${reports.priority}
              when 'urgent' then 0
              when 'high' then 1
              when 'normal' then 2
              when 'low' then 3
            end asc`,
        desc(reports.createdAt),
        tieBreak,
      ]
    case "newest":
    default:
      return [desc(reports.createdAt), tieBreak]
  }
}
