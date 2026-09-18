/**
 * The dashboard's one date format: a short relative time as the visible text
 * ("5m ago", "in 6d"), with the full date and time available on hover via
 * `formatAbsolute`. `<RelativeTime>` renders both.
 */

type DateInput = string | Date | null | undefined

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

function toMs(value: DateInput): number | null {
  if (value === null || value === undefined || value === "") return null
  const ms = value instanceof Date ? value.getTime() : Date.parse(value)
  return Number.isNaN(ms) ? null : ms
}

function span(ms: number): string {
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)}m`
  if (ms < DAY) return `${Math.floor(ms / HOUR)}h`
  const days = Math.floor(ms / DAY)
  if (days < 30) return `${days}d`
  if (days < 365) return `${Math.floor(days / 30)}mo`
  return `${Math.floor(days / 365)}y`
}

/**
 * Past: "just now" | "5m ago" | "3h ago" | "2d ago" | "4mo ago" | "2y ago".
 * Future: "in under a minute" | "in 5m" | "in 6d".
 * `compact` drops " ago" (and shortens "just now" to "now") for dense table
 * columns. Empty or unparseable input returns "".
 */
export function formatRelative(
  value: DateInput,
  opts: { now?: number; compact?: boolean } = {},
): string {
  const ms = toMs(value)
  if (ms === null) return ""
  const diff = (opts.now ?? Date.now()) - ms
  if (diff < 0) {
    const ahead = -diff
    return ahead < MINUTE ? "in under a minute" : `in ${span(ahead)}`
  }
  if (diff < MINUTE) return opts.compact ? "now" : "just now"
  return opts.compact ? span(diff) : `${span(diff)} ago`
}

/**
 * Full date and time, e.g. "Sep 18, 2026, 12:05 PM" — for tooltips and
 * `title` attributes behind a relative time. Defaults to the viewer's locale
 * and time zone.
 */
export function formatAbsolute(
  value: DateInput,
  opts: { locale?: string; timeZone?: string } = {},
): string {
  const ms = toMs(value)
  if (ms === null) return ""
  return new Intl.DateTimeFormat(opts.locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: opts.timeZone,
  }).format(ms)
}
