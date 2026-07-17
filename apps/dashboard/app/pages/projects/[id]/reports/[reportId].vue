<!--
  apps/dashboard/app/pages/projects/[id]/reports/[reportId].vue

  Dedicated full-page report view. Supersedes the 470px USlideover drawer
  which was too cramped for reports containing screenshots, replay video,
  console tables, and a triage panel. Full-width layout matches the
  Linear/Jira/Sentry pattern, yields a shareable URL, and restores the
  browser back button.
-->
<script setup lang="ts">
import type { LogsAttachment, ReportDetailDTO } from "@reprojs/shared"
import AppErrorState from "~/components/common/app-error-state.vue"
import AppLoadingSkeleton from "~/components/common/app-loading-skeleton.vue"
import ActivityTab from "~/components/report-drawer/activity-tab.vue"
import AttachmentsTab from "~/components/report-drawer/attachments-tab.vue"
import CommentsTab from "~/components/report-drawer/comments-tab.vue"
import ConsoleTab from "~/components/report-drawer/console-tab.vue"
import CookiesTab from "~/components/report-drawer/cookies-tab.vue"
import NetworkTab from "~/components/report-drawer/network-tab.vue"
import OverviewTab from "~/components/report-drawer/overview-tab.vue"
import ReplayTab from "~/components/report-drawer/replay-tab.vue"
import DrawerTabs from "~/components/report-drawer/tabs.vue"
import TriageFooter from "~/components/report-drawer/triage-footer.vue"
import { priorityColor, relativeTime } from "~/composables/use-report-format"

const route = useRoute()
const projectId = computed(() => String(route.params.id))
const reportId = computed(() => String(route.params.reportId))

// Single-report endpoint returns exactly one list-row's shape. useApi forwards
// the session cookie so protected routes resolve during SSR.
const {
  data: report,
  pending,
  refresh,
  error,
} = useApi<ReportDetailDTO>(() => `/api/projects/${projectId.value}/reports/${reportId.value}`, {
  key: computed(() => `report-${projectId.value}-${reportId.value}`),
  watch: [projectId, reportId],
})

useHead({ title: () => report.value?.title ?? "Report" })

// Role check — viewers see read-only controls in the triage panel. Mirrors the
// drawer's canEdit wiring.
const { data: meRole } = useApi<{ role: string }>(() => `/api/projects/${projectId.value}/me`, {
  key: computed(() => `me-role-${projectId.value}`),
  watch: [projectId],
  default: () => ({ role: "viewer" }),
})
const canEdit = computed(() => meRole.value?.role !== "viewer")

type TabId =
  | "overview"
  | "console"
  | "network"
  | "replay"
  | "activity"
  | "comments"
  | "cookies"
  | "attachments"
  | "system"
  | "raw"
const activeTab = ref<TabId>("overview")

// Logs attachment is lazy-loaded when a tab that needs it is opened. Matches
// the drawer's behaviour so the Console/Network bundles aren't fetched up-front
// for reports the reviewer never drills into.
const logs = ref<LogsAttachment | null>(null)
const logsLoaded = ref(false)
async function ensureLogs() {
  if (logsLoaded.value) return
  logsLoaded.value = true
  const res = await $fetch<LogsAttachment>(
    `/api/projects/${projectId.value}/reports/${reportId.value}/attachment?kind=logs`,
    { credentials: "include" },
  ).catch(() => null)
  logs.value = res ?? null
}
watch(activeTab, (t) => {
  if (t === "console" || t === "network") ensureLogs()
})

const consoleHasData = computed(
  () => logs.value !== null && (logs.value.console.length > 0 || logs.value.breadcrumbs.length > 0),
)
const networkHasData = computed(() => logs.value !== null && logs.value.network.length > 0)
const cookiesHasData = computed(() => (report.value?.context?.cookies?.length ?? 0) > 0)
const userFileCount = computed(
  () =>
    (report.value?.attachments ?? []).filter((a) => a.kind === "user-file" || a.kind === "media")
      .length,
)

const tabs = computed(() => {
  const base: { id: string; label: string; hasData?: boolean }[] = [
    { id: "overview", label: "Overview" },
    { id: "console", label: "Console", hasData: consoleHasData.value },
    { id: "network", label: "Network", hasData: networkHasData.value },
  ]
  if (report.value?.source !== "expo") {
    base.push({ id: "replay", label: "Replay", hasData: report.value?.hasReplay ?? false })
  }
  base.push({ id: "activity", label: "Activity" })
  base.push({ id: "comments", label: "Comments" })
  if (report.value?.source !== "expo") {
    base.push({ id: "cookies", label: "Cookies", hasData: cookiesHasData.value })
  }
  if (userFileCount.value > 0) {
    base.push({ id: "attachments", label: "Attachments", hasData: true })
  }
  base.push({ id: "system", label: "System" })
  base.push({ id: "raw", label: "Raw" })
  return base
})

// After a triage mutation, re-fetch the report row and refresh the activity
// feed so the timeline reflects the new event immediately.
const activityRef = ref<InstanceType<typeof ActivityTab> | null>(null)
const commentsRef = ref<InstanceType<typeof CommentsTab> | null>(null)
async function onPatched() {
  await refresh()
  if (activityRef.value) await activityRef.value.refresh()
  if (commentsRef.value) await commentsRef.value.refresh()
}

// Live-update subscription: the SSE endpoint pushes an event every time this
// report is touched (locally or via a GitHub webhook). Each event triggers the
// same refetch used by the PATCH round-trip — the activity tab, triage
// footer, and comments tab repaint from their new data.
useReportStream(
  () => projectId.value,
  () => reportId.value,
  async (e) => {
    if (e.kind === "comment_added" || e.kind === "comment_edited" || e.kind === "comment_deleted") {
      if (commentsRef.value) await commentsRef.value.refresh()
      if (activityRef.value) await activityRef.value.refresh()
      return
    }
    // triage / github_synced / github_unlinked all warrant a full refetch so
    // the drawer's every tab reflects the new row state.
    await onPatched()
  },
)

const triageOpen = ref(false)

// Keyboard shortcuts: 1-8 jump to each tab; Esc navigates back to the inbox.
function onKey(e: KeyboardEvent) {
  const target = e.target as HTMLElement | null
  const tag = target?.tagName.toLowerCase() ?? ""
  if (tag === "input" || tag === "textarea" || target?.isContentEditable) return

  if (e.key === "Escape") {
    navigateTo(`/projects/${projectId.value}/reports`)
    return
  }
  const map: Record<string, TabId> = {
    "1": "overview",
    "2": "console",
    "3": "network",
    "4": "replay",
    "5": "activity",
    "6": "cookies",
    "7": "system",
    "8": "raw",
  }
  const next = map[e.key]
  if (next) activeTab.value = next
}
onMounted(() => window.addEventListener("keydown", onKey))
onUnmounted(() => window.removeEventListener("keydown", onKey))

// priorityColor + relativeTime imported at the top from ~/composables/use-report-format
</script>

<template>
  <div v-if="pending" class="p-6">
    <AppLoadingSkeleton variant="card" />
  </div>
  <div v-else-if="error || !report" class="p-6">
    <AppErrorState
      title="Report not found"
      message="It may have been deleted, or you may not have access."
    />
  </div>
  <div
    v-else
    class="flex h-[calc(100vh-6rem)] min-h-0 rounded-xl border border-default bg-default overflow-hidden"
  >
    <!-- Main column -->
    <div class="flex-1 min-w-0 flex flex-col">
      <!-- Breadcrumb + header -->
      <header class="px-6 pt-5 pb-5 border-b border-default">
        <nav class="flex items-center gap-1.5 text-sm text-muted mb-3 font-medium">
          <NuxtLink
            :to="`/projects/${projectId}/reports`"
            class="hover:text-default transition-colors"
          >
            Reports
          </NuxtLink>
          <UIcon name="i-heroicons-chevron-right" class="size-3.5 opacity-60" />
          <span class="text-default truncate max-w-[24rem]">{{ report.title }}</span>
        </nav>
        <div class="flex items-start justify-between gap-4">
          <div class="min-w-0 flex-1">
            <h1 class="text-2xl font-semibold text-default tracking-tight truncate">
              {{ report.title }}
            </h1>
            <div class="mt-1.5 flex items-center gap-2 text-sm text-muted">
              <UIcon name="i-heroicons-globe-alt" class="size-3.5 shrink-0" />
              <span class="truncate font-mono text-sm">
                {{ report.context?.pageUrl ?? report.pageUrl }}
              </span>
              <span class="text-muted/60">·</span>
              <span class="whitespace-nowrap tabular-nums text-sm">
                {{ relativeTime(report.receivedAt) }}
              </span>
            </div>
          </div>
          <UBadge
            :label="report.priority"
            :color="priorityColor(report.priority)"
            variant="soft"
            size="md"
            class="capitalize font-medium flex-shrink-0"
          />
        </div>
      </header>

      <!-- Tab strip -->
      <DrawerTabs
        :model-value="activeTab"
        :tabs="tabs"
        class="border-b border-default px-4"
        @update:model-value="(v) => (activeTab = v as TabId)"
      />

      <!-- Tab content -->
      <div class="flex-1 min-h-0 overflow-y-auto">
        <OverviewTab
          v-if="activeTab === 'overview'"
          :project-id="projectId"
          :report="report"
          @select-tab="(t) => (activeTab = t)"
        />
        <ConsoleTab v-else-if="activeTab === 'console'" :logs="logs" />
        <NetworkTab v-else-if="activeTab === 'network'" :logs="logs" />
        <ReplayTab
          v-else-if="activeTab === 'replay'"
          :key="report.id"
          :project-id="projectId"
          :report-id="report.id"
          :has-replay="report.hasReplay"
        />
        <ActivityTab
          v-else-if="activeTab === 'activity'"
          ref="activityRef"
          :project-id="projectId"
          :report="report"
        />
        <CommentsTab
          v-else-if="activeTab === 'comments'"
          ref="commentsRef"
          :project-id="projectId"
          :report-id="report.id"
        />
        <CookiesTab v-else-if="activeTab === 'cookies'" :project-id="projectId" :report="report" />
        <AttachmentsTab
          v-else-if="activeTab === 'attachments'"
          :attachments="report.attachments ?? []"
        />
        <div v-else-if="activeTab === 'system'" class="p-5">
          <UCard :ui="{ body: 'p-4' }">
            <pre class="text-sm font-mono whitespace-pre-wrap break-all">{{
              JSON.stringify(report.context?.systemInfo ?? {}, null, 2)
            }}</pre>
          </UCard>
        </div>
        <div v-else-if="activeTab === 'raw'" class="p-5">
          <UCard :ui="{ body: 'p-4' }">
            <pre class="text-sm font-mono whitespace-pre-wrap break-all">{{
              JSON.stringify(report, null, 2)
            }}</pre>
          </UCard>
        </div>
      </div>
    </div>

    <!-- Right triage panel. Distinct surface (elevated bg + left border)
         so it reads as "meta / controls" against the main report content.
         Scrolls independently so long tag piles don't push GitHub off.
         Collapsible to a 48px rail so reviewers can reclaim horizontal
         space on narrow windows. -->
    <aside
      :class="[
        'flex-shrink-0 border-l border-default bg-elevated/40 overflow-y-auto transition-[width] duration-200',
        triageOpen ? 'w-80' : 'w-12',
      ]"
    >
      <div v-if="triageOpen" class="p-6">
        <div class="flex items-center justify-between gap-2 mb-5">
          <div class="flex items-center gap-2">
            <UIcon name="i-heroicons-adjustments-horizontal" class="size-4 text-muted" />
            <h2 class="text-sm font-semibold uppercase tracking-[0.14em] text-muted">Triage</h2>
          </div>
          <UButton
            size="xs"
            color="neutral"
            variant="ghost"
            icon="i-heroicons-chevron-double-right"
            aria-label="Collapse triage panel"
            @click="triageOpen = false"
          />
        </div>
        <TriageFooter
          :project-id="projectId"
          :report="report"
          :can-edit="canEdit"
          @patched="onPatched"
        />
      </div>
      <button
        v-else
        type="button"
        class="flex w-full flex-col items-center gap-3 py-4 text-muted hover:text-default transition-colors"
        aria-label="Expand triage panel"
        @click="triageOpen = true"
      >
        <UIcon name="i-heroicons-chevron-double-left" class="size-4" />
        <UIcon name="i-heroicons-adjustments-horizontal" class="size-4" />
        <span class="text-sm font-semibold uppercase tracking-[0.14em] [writing-mode:vertical-rl]">
          Triage
        </span>
      </button>
    </aside>
  </div>
</template>
