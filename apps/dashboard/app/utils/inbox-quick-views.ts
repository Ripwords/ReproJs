import type { InboxQuery } from "~/composables/use-inbox-query"

/**
 * Quick views are named presets over the existing URL filters — no new
 * server state. Each one sets status, assignee and priority together so
 * clicking a view replaces the previous view instead of stacking on it;
 * search, labels, source and sort are left as they are.
 *
 * `me` and `unassigned` are tokens the inbox API already understands
 * (see server/lib/inbox-query.ts resolveAssigneeFilter).
 */
export type QuickViewId = "open" | "mine" | "unassigned" | "urgent"

export interface QuickView {
  id: QuickViewId
  label: string
  icon: string
  description: string
}

const ACTIVE: readonly string[] = ["open", "in_progress"]

type QuickViewPatch = Pick<InboxQuery, "status" | "assignee" | "priority">

const PATCHES: Record<QuickViewId, QuickViewPatch> = {
  open: { status: ["open"], assignee: [], priority: [] },
  mine: { status: [...ACTIVE], assignee: ["me"], priority: [] },
  unassigned: { status: [...ACTIVE], assignee: ["unassigned"], priority: [] },
  urgent: { status: [...ACTIVE], assignee: [], priority: ["urgent"] },
}

export const QUICK_VIEWS: readonly QuickView[] = [
  { id: "open", label: "Open", icon: "i-heroicons-inbox", description: "Open reports" },
  {
    id: "mine",
    label: "Mine",
    icon: "i-heroicons-user",
    description: "Active reports assigned to your linked GitHub account",
  },
  {
    id: "unassigned",
    label: "Unassigned",
    icon: "i-heroicons-user-minus",
    description: "Active reports nobody has picked up",
  },
  {
    id: "urgent",
    label: "Urgent",
    icon: "i-heroicons-fire",
    description: "Active reports marked urgent",
  },
]

export function quickViewPatch(id: QuickViewId): QuickViewPatch {
  const p = PATCHES[id]
  return { status: [...p.status], assignee: [...p.assignee], priority: [...p.priority] }
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  const bs = new Set(b)
  return a.every((x) => bs.has(x))
}

/** The view whose facets exactly match the current query, or null. */
export function activeQuickView(query: InboxQuery): QuickViewId | null {
  for (const v of QUICK_VIEWS) {
    const p = PATCHES[v.id]
    if (
      sameSet(query.status, p.status) &&
      sameSet(query.assignee, p.assignee) &&
      sameSet(query.priority, p.priority)
    ) {
      return v.id
    }
  }
  return null
}
