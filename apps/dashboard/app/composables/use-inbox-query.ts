// apps/dashboard/app/composables/use-inbox-query.ts
import type { LocationQuery, LocationQueryRaw } from "vue-router"

export const INBOX_PAGE_SIZE = 50

const SORTS = ["newest", "oldest", "priority", "updated"] as const

export interface InboxQuery {
  status: string[]
  priority: string[]
  tag: string[]
  assignee: string[]
  source: string[]
  q: string
  sort: (typeof SORTS)[number]
  /** 1-based page number; the API offset is derived from it. */
  page: number
}

function parseCsv(v: unknown): string[] {
  if (typeof v !== "string") return []
  return v
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

function parsePage(v: unknown): number {
  if (typeof v !== "string" || !/^\d+$/.test(v)) return 1
  const n = Number(v)
  return n >= 1 ? n : 1
}

function isSort(v: unknown): v is InboxQuery["sort"] {
  return SORTS.some((s) => s === v)
}

export function parseInboxQuery(q: LocationQuery): InboxQuery {
  return {
    status: parseCsv(q.status),
    priority: parseCsv(q.priority),
    tag: parseCsv(q.tag),
    assignee: parseCsv(q.assignee),
    source: parseCsv(q.source),
    q: typeof q.q === "string" ? q.q : "",
    sort: isSort(q.sort) ? q.sort : "newest",
    page: parsePage(q.page),
  }
}

/**
 * The URL query after applying `patch`. Any change other than the page itself
 * (a filter, the search, the sort) sends the user back to page 1 — page N of
 * the old result set means nothing in the new one.
 */
export function inboxLocationQuery(
  current: InboxQuery,
  patch: Partial<InboxQuery>,
): LocationQueryRaw {
  const changesResults = Object.keys(patch).some((k) => k !== "page")
  const merged = { ...current, ...patch }
  if (changesResults) merged.page = 1
  const next: LocationQueryRaw = {}
  if (merged.status.length) next.status = merged.status.join(",")
  if (merged.priority.length) next.priority = merged.priority.join(",")
  if (merged.tag.length) next.tag = merged.tag.join(",")
  if (merged.assignee.length) next.assignee = merged.assignee.join(",")
  if (merged.source.length) next.source = merged.source.join(",")
  if (merged.q) next.q = merged.q
  if (merged.sort !== "newest") next.sort = merged.sort
  if (merged.page > 1) next.page = String(merged.page)
  return next
}

export function inboxApiQuery(query: InboxQuery): string {
  const parts: string[] = []
  if (query.status.length) parts.push(`status=${query.status.join(",")}`)
  if (query.priority.length) parts.push(`priority=${query.priority.join(",")}`)
  if (query.tag.length) parts.push(`tag=${query.tag.map(encodeURIComponent).join(",")}`)
  if (query.assignee.length)
    parts.push(`assignee=${query.assignee.map(encodeURIComponent).join(",")}`)
  if (query.source.length) parts.push(`source=${query.source.join(",")}`)
  if (query.q) parts.push(`q=${encodeURIComponent(query.q)}`)
  parts.push(`sort=${query.sort}`)
  parts.push(`limit=${INBOX_PAGE_SIZE}`)
  parts.push(`offset=${(query.page - 1) * INBOX_PAGE_SIZE}`)
  return parts.join("&")
}

export function useInboxQuery() {
  const route = useRoute()
  const router = useRouter()

  const query = computed<InboxQuery>(() => parseInboxQuery(route.query))

  function update(patch: Partial<InboxQuery>): void {
    router.replace({ query: inboxLocationQuery(query.value, patch) })
  }

  function toApi(): string {
    return inboxApiQuery(query.value)
  }

  return { query, update, toApi }
}
