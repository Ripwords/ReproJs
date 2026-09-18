<script setup lang="ts">
import type { ProjectDTO, ProjectOverviewDTO, ReportSummaryDTO } from "@reprojs/shared"
import AppEmptyState from "~/components/common/app-empty-state.vue"
import { priorityColor, priorityLabel } from "~/composables/use-report-format"
import RelativeTime from "~/components/common/relative-time.vue"
import { installLinkFor } from "~/utils/install-link"

const route = useRoute()
const projectId = computed(() => String(route.params.id))
const { isAdmin } = useSession()
const installLink = computed(() => installLinkFor(isAdmin.value, projectId.value))

const { data: project } = await useApi<ProjectDTO>(`/api/projects/${projectId.value}`)

useHead({ title: () => project.value?.name ?? "Project" })
const { data: overview } = await useApi<ProjectOverviewDTO>(
  `/api/projects/${projectId.value}/overview`,
)
const { data: recentReportsResp } = await useApi<{ items: ReportSummaryDTO[] }>(
  `/api/projects/${projectId.value}/reports`,
  { query: { limit: 5, sort: "newest" } },
)

const metrics = computed(() => {
  const c = overview.value?.counts
  if (!c) return null
  return {
    open: c.byStatus.open ?? 0,
    newThisWeek: c.last7Days,
    total: c.total,
  }
})

const integration = computed(() => {
  const g = overview.value?.github
  if (!g || !g.installed) return { status: "not connected" as const, repoFullName: null }
  return {
    status: g.status ?? "not connected",
    repoFullName: g.repo,
    linkedCount: g.linkedCount,
    failedCount: g.failedCount,
  }
})

const recentReports = computed<ReportSummaryDTO[]>(() => recentReportsResp.value?.items ?? [])
const recentActivity = computed(() => overview.value?.recentEvents ?? [])

const EVENT_LABEL: Record<string, string> = {
  status_changed: "changed status",
  priority_changed: "changed priority",
  assignee_changed: "reassigned",
  tag_added: "added a label",
  tag_removed: "removed a label",
  github_unlinked: "unlinked GitHub issue",
}

function describeEvent(e: ProjectOverviewDTO["recentEvents"][number]): string {
  const label = EVENT_LABEL[e.kind] ?? e.kind
  return `${label} on "${e.reportTitle}"`
}
</script>

<template>
  <div class="space-y-8">
    <!-- Page header -->
    <header class="flex items-end justify-between gap-4">
      <div>
        <div class="text-sm font-medium uppercase tracking-[0.18em] text-muted">Project</div>
        <h1 class="mt-1 text-3xl font-semibold text-default tracking-tight">
          {{ project?.name ?? "…" }}
        </h1>
        <p class="mt-1.5 text-sm text-muted">
          Snapshot of incoming reports, health, and recent team activity.
        </p>
      </div>
      <UButton
        :to="`/projects/${projectId}/reports`"
        label="Go to inbox"
        trailing-icon="i-heroicons-arrow-right"
        color="primary"
        size="md"
      />
    </header>

    <!-- Metric tiles: each tile has a small icon chip + eyebrow label above
         a big number. The tiles lift slightly on hover to signal they're
         interactive (they link into the relevant filtered view). -->
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <NuxtLink
        :to="`/projects/${projectId}/reports?status=open`"
        class="group relative overflow-hidden rounded-xl border border-default bg-default p-5 transition hover:border-primary/40 hover:-translate-y-0.5 hover:shadow-[0_12px_32px_-12px_rgba(0,0,0,0.14)]"
      >
        <div class="flex items-center justify-between">
          <div
            class="flex items-center justify-center size-8 rounded-lg bg-primary/10 text-primary ring-1 ring-primary/15"
          >
            <UIcon name="i-heroicons-inbox" class="size-4" />
          </div>
          <UIcon
            name="i-heroicons-arrow-up-right"
            class="size-3.5 text-muted opacity-0 group-hover:opacity-100 transition"
          />
        </div>
        <div class="mt-4 text-sm font-medium uppercase tracking-wider text-muted">Open reports</div>
        <div class="mt-1 text-3xl font-semibold text-default tracking-tight tabular-nums">
          {{ metrics?.open ?? 0 }}
        </div>
      </NuxtLink>

      <div class="relative overflow-hidden rounded-xl border border-default bg-default p-5">
        <div class="flex items-center justify-center size-8 rounded-lg bg-muted text-muted">
          <UIcon name="i-heroicons-sparkles" class="size-4" />
        </div>
        <div class="mt-4 text-sm font-medium uppercase tracking-wider text-muted">
          New · last 7 days
        </div>
        <div class="mt-1 text-3xl font-semibold text-default tracking-tight tabular-nums">
          {{ metrics?.newThisWeek ?? 0 }}
        </div>
      </div>

      <div class="relative overflow-hidden rounded-xl border border-default bg-default p-5">
        <div class="flex items-center justify-center size-8 rounded-lg bg-muted text-muted">
          <UIcon name="i-heroicons-chart-bar" class="size-4" />
        </div>
        <div class="mt-4 text-sm font-medium uppercase tracking-wider text-muted">
          Total reports
        </div>
        <div class="mt-1 text-3xl font-semibold text-default tracking-tight tabular-nums">
          {{ metrics?.total ?? 0 }}
        </div>
      </div>

      <NuxtLink
        :to="`/projects/${projectId}/integrations`"
        class="group relative overflow-hidden rounded-xl border border-default bg-default p-5 transition hover:border-primary/40 hover:-translate-y-0.5 hover:shadow-[0_12px_32px_-12px_rgba(0,0,0,0.14)]"
      >
        <div class="flex items-center justify-between">
          <div
            class="flex items-center justify-center size-8 rounded-lg"
            :class="
              integration.status === 'connected'
                ? 'bg-success/10 text-success ring-1 ring-success/20'
                : 'bg-muted text-muted'
            "
          >
            <UIcon name="i-simple-icons-github" class="size-4" />
          </div>
          <UIcon
            name="i-heroicons-arrow-up-right"
            class="size-3.5 text-muted opacity-0 group-hover:opacity-100 transition"
          />
        </div>
        <div class="mt-4 text-sm font-medium uppercase tracking-wider text-muted">GitHub sync</div>
        <div
          class="mt-1 text-base font-semibold text-default tracking-tight truncate"
          :class="{ 'text-muted': integration.status !== 'connected' }"
        >
          {{ integration.repoFullName ?? "Not connected" }}
        </div>
      </NuxtLink>
    </div>

    <!-- Two-column: recent reports + recent activity -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div class="rounded-xl border border-default bg-default">
        <div class="flex items-center justify-between px-5 py-4 border-b border-default">
          <h2 class="text-sm font-semibold text-default tracking-tight">Recent reports</h2>
          <NuxtLink
            :to="`/projects/${projectId}/reports`"
            class="text-sm font-medium text-muted hover:text-primary transition-colors"
          >
            View all →
          </NuxtLink>
        </div>
        <div
          v-if="!recentReports || recentReports.length === 0"
          class="text-sm text-muted py-10 text-center"
        >
          No reports yet.
        </div>
        <ul v-else class="divide-y divide-default">
          <li v-for="r in recentReports" :key="r.id">
            <NuxtLink
              :to="`/projects/${projectId}/reports/${r.id}`"
              class="flex items-center gap-3 px-5 py-3 text-sm transition-colors hover:bg-elevated/50"
            >
              <UBadge
                :label="priorityLabel(r.priority)"
                :color="priorityColor(r.priority)"
                variant="soft"
                size="sm"
                class="shrink-0"
              />
              <span class="flex-1 min-w-0 truncate text-default">{{ r.title }}</span>
              <span class="text-sm text-muted whitespace-nowrap tabular-nums">
                <RelativeTime :value="r.receivedAt" />
              </span>
            </NuxtLink>
          </li>
        </ul>
      </div>

      <div class="rounded-xl border border-default bg-default">
        <div class="px-5 py-4 border-b border-default">
          <h2 class="text-sm font-semibold text-default tracking-tight">Activity</h2>
        </div>
        <div
          v-if="!recentActivity || recentActivity.length === 0"
          class="text-sm text-muted py-10 text-center"
        >
          No activity yet.
        </div>
        <ul v-else class="px-5 py-4 space-y-3.5">
          <li v-for="e in recentActivity" :key="e.id" class="flex items-start gap-3 text-sm">
            <span
              class="shrink-0 mt-1.5 inline-block size-1.5 rounded-full bg-primary/60"
              aria-hidden="true"
            />
            <div class="flex-1 min-w-0">
              <span class="text-default font-medium">
                {{ e.actor?.name ?? e.actor?.email ?? "System" }}
              </span>
              <span>&nbsp;</span>
              <span class="text-muted"> {{ describeEvent(e) }}</span>
              <div class="mt-0.5 text-sm text-muted tabular-nums">
                <RelativeTime :value="e.createdAt" />
              </div>
            </div>
          </li>
        </ul>
      </div>
    </div>

    <!-- Activation CTA when no reports -->
    <AppEmptyState
      v-if="recentReports && recentReports.length === 0"
      variant="gradient"
      icon="i-heroicons-code-bracket"
      title="Install the SDK to start receiving reports"
      description="Add a single <script> tag to your site or npm-install @reprojs/core."
      :action-label="installLink.label"
      :action-to="installLink.to"
    />
  </div>
</template>
