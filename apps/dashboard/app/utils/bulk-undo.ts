import type { BulkUpdateInput, ReportStatus } from "@reprojs/shared"

/** What a report looked like just before a bulk update — enough to put it back. */
export interface BulkUndoSnapshot {
  id: string
  status: ReportStatus
  assignees: string[]
}

export type BulkChange = Partial<Pick<BulkUpdateInput, "status" | "assignees">>

/**
 * The bulk-update requests that reverse `applied` on `before`.
 *
 * A bulk update sets one value on every selected report, but the reports
 * may each have come from a different value, so the inverse is one request
 * per distinct previous value. Reports that already had the new value are
 * left out: the update did not change them, so undo must not either.
 */
export function inverseBulkChange(
  before: readonly BulkUndoSnapshot[],
  applied: BulkChange,
): BulkUpdateInput[] {
  const out: BulkUpdateInput[] = []

  if (applied.status !== undefined) {
    const byStatus = new Map<ReportStatus, string[]>()
    for (const r of before) {
      if (r.status === applied.status) continue
      const ids = byStatus.get(r.status) ?? []
      ids.push(r.id)
      byStatus.set(r.status, ids)
    }
    for (const [status, reportIds] of byStatus) out.push({ reportIds, status })
  }

  if (applied.assignees !== undefined) {
    const target = sortedKey(applied.assignees)
    const byAssignees = new Map<string, { assignees: string[]; reportIds: string[] }>()
    for (const r of before) {
      const key = sortedKey(r.assignees)
      if (key === target) continue
      const group = byAssignees.get(key) ?? { assignees: [...r.assignees], reportIds: [] }
      group.reportIds.push(r.id)
      byAssignees.set(key, group)
    }
    for (const { assignees, reportIds } of byAssignees.values()) out.push({ reportIds, assignees })
  }

  return out
}

function sortedKey(logins: readonly string[]): string {
  return [...logins].toSorted().join("\u0000")
}
