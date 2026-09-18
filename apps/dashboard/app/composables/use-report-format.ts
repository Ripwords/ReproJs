/**
 * Shared display helpers for reports — previously duplicated across the
 * projects overview, inbox list, and report-detail page, each with subtle
 * inconsistencies in granularity (hour-only on overview, minute+hour+day on
 * the others). Centralize here so updates land in one place.
 */

export type ReportBadgeColor = "error" | "warning" | "primary" | "success" | "info" | "neutral"

/**
 * Map a report priority to a semantic badge color. Undefined / unknown
 * priorities fall back to "neutral" so the call sites can pass `report.priority`
 * directly without an extra guard.
 */
export function priorityColor(p: string | undefined | null): ReportBadgeColor {
  if (p === "urgent") return "error"
  if (p === "high") return "warning"
  if (p === "normal") return "primary"
  return "neutral"
}

export function statusColor(s: string | undefined | null): ReportBadgeColor {
  if (s === "open") return "error"
  if (s === "in_progress") return "warning"
  if (s === "resolved") return "success"
  if (s === "closed") return "neutral"
  return "neutral"
}

const STATUS_LABEL: Record<string, string> = {
  open: "Open",
  in_progress: "In progress",
  resolved: "Resolved",
  closed: "Closed",
}
export function statusLabel(s: string | undefined | null): string {
  if (!s) return "Unknown"
  return STATUS_LABEL[s] ?? s
}

const PRIORITY_LABEL: Record<string, string> = {
  urgent: "Urgent",
  high: "High",
  normal: "Normal",
  low: "Low",
}
export function priorityLabel(p: string | undefined | null): string {
  if (!p) return "—"
  return PRIORITY_LABEL[p] ?? p
}
