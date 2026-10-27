<!-- apps/dashboard/app/pages/projects/[id]/reports.vue -->
<script setup lang="ts">
import PageHeader from "~/components/common/page-header.vue"
import { describeApiError } from "~/utils/api-error"
import { h, resolveComponent } from "vue"
import type { TableColumn } from "@nuxt/ui"
import type {
  BulkUpdateInput,
  ReportListDTO,
  ReportPriority,
  ReportStatus,
  ReportSummaryDTO,
} from "@reprojs/shared"
import { inverseBulkChange, type BulkChange, type BulkUndoSnapshot } from "~/utils/bulk-undo"
import StatusTabs from "~/components/inbox/status-tabs.vue"
import FacetSidebar from "~/components/inbox/facet-sidebar.vue"
import SearchSort from "~/components/inbox/search-sort.vue"
import BulkActionBar from "~/components/inbox/bulk-action-bar.vue"
import AppEmptyState from "~/components/common/app-empty-state.vue"
import KeyboardShortcutsModal from "~/components/common/keyboard-shortcuts-modal.vue"
import {
  INBOX_PAGE_SIZE,
  inboxLocationQuery,
  initialStatusForVisit,
  rememberedStatusTab,
  useInboxQuery,
} from "~/composables/use-inbox-query"
import { useKeyboardShortcuts } from "~/composables/useKeyboardShortcuts"
import {
  priorityColor,
  priorityLabel,
  statusColor,
  statusLabel,
} from "~/composables/use-report-format"
import RelativeTime from "~/components/common/relative-time.vue"
import { installLinkFor } from "~/utils/install-link"
import { activeQuickView, quickViewPatch, type QuickViewId } from "~/utils/inbox-quick-views"

const UCheckbox = resolveComponent("UCheckbox")
const UBadge = resolveComponent("UBadge")
const UIcon = resolveComponent("UIcon")
const UTooltip = resolveComponent("UTooltip")

const route = useRoute()
const toast = useToast()
const projectId = computed(() => route.params.id as string)

useHead({ title: "Reports" })

const { query, update, toApi } = useInboxQuery()

// ---- Default tab ----
// A fresh visit (no inbox params in the URL) opens on the tab the user last
// chose for this project, defaulting to Open. Deep links keep their own
// state. Runs before the list fetch so the first request is already the
// right one, and uses `replace` so Back doesn't land on the unfiltered URL.
const rememberedTab = useCookie<string | null>(`inbox-status-${projectId.value}`, {
  default: () => null,
})
const initialStatus = initialStatusForVisit(route.query, rememberedTab.value)
if (initialStatus) {
  await navigateTo(
    { query: inboxLocationQuery(query.value, { status: initialStatus }) },
    { replace: true },
  )
}

function changeStatus(status: ReportStatus[]) {
  rememberedTab.value = rememberedStatusTab(status)
  update({ status })
}

// ---- Quick views ----
const currentView = computed<QuickViewId | null>(() => activeQuickView(query.value))
function applyView(id: QuickViewId) {
  const patch = quickViewPatch(id)
  rememberedTab.value = rememberedStatusTab(patch.status)
  update(patch)
}

const listUrl = computed(() => `/api/projects/${projectId.value}/reports?${toApi()}`)
const { data, pending, refresh } = useApi<ReportListDTO>(listUrl, { watch: [listUrl] })

const reports = computed<ReportSummaryDTO[]>(() => data.value?.items ?? [])

const submittingBulk = ref(false)

// UTable uses a row-selection map keyed by row index (or id). We map it to our
// checked Set of report IDs so the existing bulk handlers still work.
const rowSelection = ref<Record<string, boolean>>({})
const checkedIds = computed<string[]>(() =>
  Object.entries(rowSelection.value)
    .filter(([, v]) => v)
    .map(([k]) => k)
    .filter((id) => reports.value.some((r) => r.id === id)),
)

function clearSelection() {
  rowSelection.value = {}
}

// "Select all" in the header selects the rows on this page only, and the bulk
// bar acts on exactly what is ticked. Drop the selection whenever the visible
// result set changes (page, filter, search, sort) so ticks from a page the
// user can no longer see are never carried into a bulk action.
watch(listUrl, clearSelection)

// ---- Pagination ----
const total = computed(() => data.value?.total ?? 0)
const pageCount = computed(() => Math.max(1, Math.ceil(total.value / INBOX_PAGE_SIZE)))
const rangeStart = computed(() => (query.value.page - 1) * INBOX_PAGE_SIZE + 1)
const rangeEnd = computed(() => rangeStart.value + reports.value.length - 1)

// A bulk update or someone else's triage can shrink the result set until the
// current page is past the end. Land on the last page that has rows instead of
// showing "No reports match" for a filter that still matches.
// `immediate` also covers a stale deep link such as ?page=9.
watch(
  data,
  (next) => {
    if (import.meta.server || !next || next.items.length > 0 || next.total === 0) return
    if (query.value.page > pageCount.value) update({ page: pageCount.value })
  },
  { immediate: true },
)

// One path for every bulk action. Before posting, snapshot the selected
// rows so the success toast can offer Undo: the inverse is one request per
// previous value (see utils/bulk-undo), posted through the same endpoint.
async function postBulk(body: BulkUpdateInput) {
  await $fetch(`/api/projects/${projectId.value}/reports/bulk-update`, {
    method: "POST",
    body,
    credentials: "include",
  })
}

async function undoBulk(inverse: BulkUpdateInput[]) {
  try {
    // Sequential on purpose: each group is one request and the server
    // enqueues GitHub syncs per batch; parallel posts gain nothing here.
    for (const body of inverse) await postBulk(body) // oxlint-disable-line no-await-in-loop
    await refresh()
    toast.add({ title: "Change undone", color: "success", icon: "i-heroicons-arrow-uturn-left" })
  } catch (err) {
    toast.add({
      title: "Could not undo",
      description: describeApiError(err),
      color: "error",
      icon: "i-heroicons-exclamation-triangle",
    })
  }
}

async function runBulk(change: BulkChange) {
  submittingBulk.value = true
  const ids = checkedIds.value
  const n = ids.length
  const before: BulkUndoSnapshot[] = reports.value
    .filter((r) => ids.includes(r.id))
    .map((r) => ({ id: r.id, status: r.status, assignees: r.assignees.map((a) => a.login) }))
  try {
    await postBulk({ reportIds: ids, ...change })
    clearSelection()
    await refresh()
    const inverse = inverseBulkChange(before, change)
    toast.add({
      title: `${n} report${n === 1 ? "" : "s"} updated`,
      color: "success",
      icon: "i-heroicons-check-circle",
      actions:
        inverse.length > 0
          ? [
              {
                label: "Undo",
                icon: "i-heroicons-arrow-uturn-left",
                color: "neutral",
                variant: "outline",
                onClick: () => void undoBulk(inverse),
              },
            ]
          : undefined,
    })
  } catch (err) {
    toast.add({
      title: "Could not update reports",
      description: describeApiError(err),
      color: "error",
      icon: "i-heroicons-exclamation-triangle",
    })
  } finally {
    submittingBulk.value = false
  }
}
const bulkStatus = (status: ReportStatus) => runBulk({ status })
const bulkAssign = (login: string | null) => runBulk({ assignees: login ? [login] : [] })

// Row click / keyboard activation navigates to the dedicated report page.
// Replaces the previous drawer integration — dedicated page gives full width,
// a shareable URL, and proper browser back-button behaviour.
function openReport(reportId: string) {
  navigateTo(`/projects/${projectId.value}/reports/${reportId}`)
}

// Assignee bulk-options come from the github logins surfaced by the facet.
// The dashboard no longer tracks its own assignee identity — "Me" only makes
// sense if the current session user has linked a github identity, and we
// don't have that value on the client, so drop the shortcut. Users can
// still pick their own login from the list.
const assigneeOptions = computed(() => {
  const opts: Array<{ value: string | null; label: string }> = [{ value: null, label: "Unassign" }]
  for (const a of data.value?.facets.assignees ?? []) {
    opts.push({ value: a.login, label: `@${a.login}` })
  }
  return opts
})

// ---- Filters / empty state ----
const hasActiveFilters = computed(
  () =>
    query.value.q.length > 0 ||
    query.value.status.length > 0 ||
    query.value.priority.length > 0 ||
    query.value.assignee.length > 0 ||
    query.value.tag.length > 0 ||
    query.value.source.length > 0,
)

// Source facets are counted project-wide (not by the active filters), so
// their sum tells "this project has never received a report" apart from
// "this tab is empty". The former gets the install CTA even though the
// default Open tab is technically a filter.
const projectHasReports = computed(() => {
  const s = data.value?.facets.source
  if (!s) return true
  return s.web + s.expo + s.ios + s.android > 0
})
const showInstallState = computed(() => !projectHasReports.value)

const { isAdmin } = useSession()
const installLink = computed(() => installLinkFor(isAdmin.value, projectId.value))

function clearFilters() {
  rememberedTab.value = "all"
  update({ q: "", status: [], priority: [], assignee: [], tag: [], source: [] })
}

// ---- Keyboard navigation ----
// j/k (or the arrows) move a highlight through the rows; Enter opens the
// highlighted report. UTable renders every row with tabindex=0 (because we
// pass @select), so the highlighted row also receives focus — screen
// readers announce it and Tab continues from there. The highlight class is
// applied through UTable's `meta.class.tr`, which is the only per-row hook.
const ROW_HIGHLIGHT_CLASS = "inbox-row-highlighted"
const highlightedIndex = ref(-1)
const tableWrap = ref<HTMLElement | null>(null)

watch(reports, (next) => {
  if (next.length === 0) {
    highlightedIndex.value = -1
  } else if (highlightedIndex.value >= next.length) {
    highlightedIndex.value = next.length - 1
  }
})

const tableMeta = {
  class: {
    tr: (row: { index: number }) =>
      row.index === highlightedIndex.value ? ROW_HIGHLIGHT_CLASS : "",
  },
}

function bodyRows(): HTMLElement[] {
  const root = tableWrap.value
  if (!root) return []
  return Array.from(root.querySelectorAll<HTMLElement>('tbody tr[data-slot="tr"]'))
}

function moveSelection(delta: number) {
  const list = reports.value
  if (list.length === 0) return
  const next = Math.min(
    Math.max(0, highlightedIndex.value === -1 ? 0 : highlightedIndex.value + delta),
    list.length - 1,
  )
  highlightedIndex.value = next
  // Wait for the class to land on the new row before scrolling/focusing it.
  void nextTick(() => {
    const row = bodyRows()[next]
    row?.scrollIntoView({ block: "nearest" })
    row?.focus({ preventScroll: true })
  })
}
function openCurrent() {
  const list = reports.value
  const idx = highlightedIndex.value
  if (idx < 0 || idx >= list.length) return
  const row = list[idx]
  if (row) openReport(row.id)
}

// Tabbing onto a row (mouse users, screen readers) moves the highlight too,
// so a following j/k or Enter acts on the row that actually has focus.
function onTableFocusIn(e: FocusEvent) {
  const tr = (e.target as HTMLElement | null)?.closest<HTMLElement>('tbody tr[data-slot="tr"]')
  if (!tr) return
  const idx = bodyRows().indexOf(tr)
  if (idx >= 0) highlightedIndex.value = idx
}

const shortcutsOpen = ref(false)
const shortcutList = [
  { keys: ["j", "k"], label: "Move highlight down / up" },
  { keys: ["↓", "↑"], label: "Move highlight down / up" },
  { keys: ["Enter"], label: "Open highlighted report" },
  { keys: ["?"], label: "Show this help" },
  { keys: ["Esc"], label: "On a report: back to the inbox" },
  { keys: ["1", "…", "0"], label: "On a report: jump to a tab" },
]

useKeyboardShortcuts({
  j: () => moveSelection(1),
  k: () => moveSelection(-1),
  arrowdown: (e) => {
    e.preventDefault()
    moveSelection(1)
  },
  arrowup: (e) => {
    e.preventDefault()
    moveSelection(-1)
  },
  enter: (e) => {
    // Enter opens the highlighted report only when focus sits on the row
    // itself (UTable gives it role="button") or on a plain cell. A focused
    // control inside the row — the selection checkbox, a link, a menu
    // trigger — keeps its own Enter behaviour, as does anything outside the
    // table (pagination, filters).
    const t = e.target as HTMLElement | null
    const row = t?.closest<HTMLElement>('tbody tr[data-slot="tr"]')
    if (!t || !row) return
    if (t !== row) {
      const control = t.closest(
        'button, a, input, select, [role="checkbox"], [role="menuitem"], [role="option"]',
      )
      if (control && control !== row) return
    }
    e.preventDefault()
    openCurrent()
  },
  "?": (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    e.preventDefault()
    shortcutsOpen.value = !shortcutsOpen.value
  },
})

// ---- Columns ----

const columns = computed<TableColumn<ReportSummaryDTO>[]>(() => [
  {
    id: "select",
    header: ({ table }) =>
      h(UCheckbox, {
        modelValue: table.getIsAllPageRowsSelected(),
        "onUpdate:modelValue": (v: boolean) => table.toggleAllPageRowsSelected(!!v),
        ariaLabel: "Select all",
      }),
    cell: ({ row }) =>
      h(UCheckbox, {
        modelValue: row.getIsSelected(),
        "onUpdate:modelValue": (v: boolean) => row.toggleSelected(!!v),
        ariaLabel: "Select row",
        onClick: (e: MouseEvent) => e.stopPropagation(),
      }),
  },
  {
    accessorKey: "priority",
    header: "Priority",
    cell: ({ row }) =>
      h(UBadge, {
        label: priorityLabel(row.original.priority),
        color: priorityColor(row.original.priority),
        variant: "soft",
        size: "md",
        class: "font-medium",
      }),
  },
  {
    accessorKey: "title",
    header: "Title",
    cell: ({ row }) =>
      h("div", { class: "font-medium text-default truncate max-w-[32rem]" }, row.original.title),
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) =>
      h(UBadge, {
        label: statusLabel(row.original.status),
        color: statusColor(row.original.status),
        variant: "subtle",
        size: "md",
        class: "font-medium whitespace-nowrap",
      }),
  },
  {
    id: "source",
    header: "",
    cell: ({ row }) => {
      const r = row.original
      const label =
        r.source === "web"
          ? "Web"
          : r.devicePlatform === "ios"
            ? "iOS"
            : r.devicePlatform === "android"
              ? "Android"
              : "Mobile"
      const color =
        r.source === "web" ? "neutral" : r.devicePlatform === "ios" ? "primary" : "warning"
      return h(UBadge, { variant: "subtle", color, size: "xs" }, () => label)
    },
  },
  {
    id: "github",
    header: "",
    cell: ({ row }) => {
      const n = row.original.githubIssueNumber
      const url = row.original.githubIssueUrl
      if (n == null || !url) {
        // Reporter typed an issue number into the widget but nobody has
        // attached the report yet. Subtle chip; the tooltip says it's a hint.
        const hint = row.original.reporterIssueHint
        if (hint == null) return h("span", { class: "text-muted text-sm" }, "—")
        return h(
          UTooltip,
          {
            text: `Reporter referenced issue #${hint}. Not attached yet — nothing has been posted to GitHub.`,
          },
          () =>
            h(
              "span",
              {
                class:
                  "inline-flex items-center gap-0.5 text-xs text-dimmed tabular-nums rounded-full px-1.5 py-0.5 ring-1 ring-inset ring-default/60",
                "aria-label": `Reporter referenced issue #${hint}, not attached`,
              },
              [
                h(UIcon, { name: "i-heroicons-arrow-up-right", class: "size-3" }),
                h("span", {}, `#${hint}?`),
              ],
            ),
        )
      }
      return h(
        "a",
        {
          href: url,
          target: "_blank",
          rel: "noopener",
          class: "inline-flex items-center gap-1 text-sm text-muted hover:text-default transition",
          title: `GitHub issue #${n}`,
          onClick: (e: MouseEvent) => e.stopPropagation(),
        },
        [h(UIcon, { name: "i-simple-icons-github", class: "size-3.5" }), h("span", {}, `#${n}`)],
      )
    },
  },
  {
    id: "assignee",
    header: "Assignee",
    cell: ({ row }) => {
      const a = row.original.assignees?.[0]
      if (!a) return h("span", { class: "text-muted text-sm" }, "—")
      return h("span", { class: "inline-flex items-center gap-2 text-sm" }, [
        a.avatarUrl
          ? h("img", {
              src: a.avatarUrl,
              alt: a.login,
              class: "size-5 rounded-full",
            })
          : h(
              "span",
              {
                class:
                  "size-5 rounded-full bg-elevated text-default flex items-center justify-center text-sm font-semibold",
              },
              a.login.slice(0, 2).toUpperCase(),
            ),
        h("span", { class: "truncate max-w-[8rem]" }, `@${a.login}`),
      ])
    },
  },
  {
    accessorKey: "reporterEmail",
    header: "Reporter",
    cell: ({ row }) =>
      h(
        "span",
        { class: "text-sm text-muted truncate max-w-[10rem] inline-block" },
        row.original.reporterEmail ?? "—",
      ),
  },
  {
    accessorKey: "receivedAt",
    header: "",
    cell: ({ row }) =>
      h("span", { class: "text-sm text-muted whitespace-nowrap" }, [
        h(RelativeTime, { value: row.original.receivedAt, compact: true }),
      ]),
  },
])

// Use report id as the row id so row-selection keys match our report ids.
function getRowId(row: ReportSummaryDTO): string {
  return row.id
}

type TableRowLike = { original: ReportSummaryDTO; index: number }
function onRowSelect(_e: Event, row: TableRowLike) {
  highlightedIndex.value = row.index
  openReport(row.original.id)
}
</script>

<template>
  <div class="flex gap-6 h-[calc(100vh-8rem)]">
    <FacetSidebar
      class="w-60 flex-shrink-0 overflow-y-auto"
      :priority-counts="data?.facets.priority ?? ({} as Record<ReportPriority, number>)"
      :assignees="data?.facets.assignees ?? []"
      :tags="data?.facets.tags ?? []"
      :source-counts="data?.facets.source ?? { web: 0, expo: 0, ios: 0, android: 0 }"
      :selected-priority="query.priority as ReportPriority[]"
      :selected-assignee="query.assignee"
      :selected-tags="query.tag"
      :selected-source="query.source"
      :active-view="currentView"
      @priority="update({ priority: $event })"
      @assignee="update({ assignee: $event })"
      @tag="update({ tag: $event })"
      @source="update({ source: $event })"
      @view="applyView"
    />

    <div class="flex-1 min-w-0 flex flex-col">
      <PageHeader eyebrow="Project" title="Reports" class="mb-4">
        <template #actions>
          <span class="text-sm text-muted">{{ total }} matches</span>
        </template>
      </PageHeader>

      <div class="mb-3">
        <BulkActionBar
          v-if="checkedIds.length > 0"
          :count="checkedIds.length"
          :assignee-options="assigneeOptions"
          :submitting="submittingBulk"
          @status="bulkStatus"
          @assign="bulkAssign"
          @clear="clearSelection"
        />
        <SearchSort
          v-else
          :query="query.q"
          :sort="query.sort"
          @update:query="update({ q: $event })"
          @update:sort="update({ sort: $event })"
        />
      </div>

      <StatusTabs
        class="mb-3"
        :selected="query.status as ReportStatus[]"
        :counts="data?.facets.status ?? ({} as Record<ReportStatus, number>)"
        :total="data?.total ?? 0"
        @change="changeStatus"
      />

      <div
        ref="tableWrap"
        class="flex-1 min-h-0 overflow-y-auto rounded-xl border border-default bg-default"
        @focusin="onTableFocusIn"
      >
        <AppEmptyState
          v-if="!pending && reports.length === 0"
          :icon="showInstallState ? 'i-heroicons-inbox' : 'i-heroicons-funnel'"
          :title="showInstallState ? 'No reports yet' : 'No reports match these filters'"
          :description="
            showInstallState
              ? 'Reports will appear here when the SDK is installed and users submit bugs.'
              : hasActiveFilters
                ? 'Try clearing the search or adjusting the filters.'
                : 'Nothing here right now.'
          "
          :action-label="showInstallState ? installLink.label : 'Clear filters'"
          :action-to="showInstallState ? installLink.to : undefined"
          :variant="showInstallState ? 'gradient' : 'plain'"
          @action="clearFilters"
        />
        <UTable
          v-else
          v-model:row-selection="rowSelection"
          :data="reports"
          :columns="columns"
          :loading="pending"
          :get-row-id="getRowId"
          :meta="tableMeta"
          :ui="{
            th: 'text-sm font-medium text-muted',
            td: 'py-2 text-sm',
            tr: 'cursor-pointer hover:bg-neutral-50/50 dark:hover:bg-neutral-900/30 focus-visible:outline-none focus-visible:bg-primary/5 [&.inbox-row-highlighted]:bg-primary/10 [&.inbox-row-highlighted]:shadow-[inset_2px_0_0_0_var(--ui-primary)]',
          }"
          @select="onRowSelect"
        />
      </div>

      <div class="mt-2 flex items-center justify-end">
        <button
          type="button"
          class="inline-flex items-center gap-1.5 text-sm text-muted hover:text-default transition-colors"
          @click="shortcutsOpen = true"
        >
          <UKbd>?</UKbd>
          <span>Keyboard shortcuts</span>
        </button>
      </div>

      <KeyboardShortcutsModal
        :open="shortcutsOpen"
        :shortcuts="shortcutList"
        @update:open="shortcutsOpen = $event"
      />

      <div
        v-if="pageCount > 1"
        class="mt-3 flex items-center justify-between gap-4"
        data-testid="inbox-pagination"
      >
        <span class="text-sm text-muted">
          {{ reports.length > 0 ? `${rangeStart}–${rangeEnd} of ${total}` : `${total} matches` }}
        </span>
        <UPagination
          :page="query.page"
          :total="total"
          :items-per-page="INBOX_PAGE_SIZE"
          :sibling-count="1"
          show-edges
          size="sm"
          @update:page="update({ page: $event })"
        />
      </div>
    </div>
  </div>
</template>
