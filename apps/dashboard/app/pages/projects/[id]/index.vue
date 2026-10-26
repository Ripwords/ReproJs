<script setup lang="ts">
import PageHeader from "~/components/common/page-header.vue"
import type { ProjectDTO, ProjectOverviewDTO, ReportSummaryDTO } from "@reprojs/shared"
import InstallSnippet from "~/components/common/install-snippet.vue"
import AppLoadingSkeleton from "~/components/common/app-loading-skeleton.vue"
import { priorityColor, priorityLabel } from "~/composables/use-report-format"
import RelativeTime from "~/components/common/relative-time.vue"
import { installLinkFor } from "~/utils/install-link"

const route = useRoute()
const projectId = computed(() => String(route.params.id))
const { isAdmin } = useSession()
const installLink = computed(() => installLinkFor(isAdmin.value, projectId.value))

const { data: project, pending: projectPending } = await useApi<ProjectDTO>(
  `/api/projects/${projectId.value}`,
)

useHead({ title: () => project.value?.name ?? "Project" })
const { data: overview, pending: overviewPending } = await useApi<ProjectOverviewDTO>(
  `/api/projects/${projectId.value}/overview`,
)
const { data: recentReportsResp, pending: recentPending } = await useApi<{
  items: ReportSummaryDTO[]
}>(`/api/projects/${projectId.value}/reports`, { query: { limit: 5, sort: "newest" } })

// First load only — a background refresh keeps the rendered page.
const loading = computed(
  () =>
    (projectPending.value && !project.value) ||
    (overviewPending.value && !overview.value) ||
    (recentPending.value && !recentReportsResp.value),
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

// ---- Setup checklist (zero reports) ----
// `total` comes from the overview counts; fall back to the recent list so the
// checklist still renders if the overview call failed.
const hasNoReports = computed(() => {
  const total = overview.value?.counts.total
  return total !== undefined ? total === 0 : recentReports.value.length === 0
})
const hasOrigins = computed(() => (project.value?.allowedOrigins.length ?? 0) > 0)
// Whether the key was copied is only knowable on the client, so remember it
// per project in a cookie — same pattern as `last-project-id`.
const keyCopied = useCookie<boolean>(`setup-key-copied-${projectId.value}`, {
  default: () => false,
})
const isOwner = computed(() => project.value?.effectiveRole === "owner")
interface SetupStep {
  id: string
  done: boolean
  label: string
  hint: string
  to?: string
}
const setupSteps = computed<SetupStep[]>(() => [
  {
    id: "key",
    done: keyCopied.value,
    label: "Copy the embed snippet",
    hint: "It includes this project's public key and your dashboard URL.",
  },
  {
    id: "origin",
    done: hasOrigins.value,
    label: "Add an allowed origin",
    hint: isOwner.value
      ? "The SDK can only submit from origins on the list."
      : "Only a project owner can add origins in Settings → General.",
    to: `/projects/${projectId.value}/settings`,
  },
  {
    id: "report",
    done: !hasNoReports.value,
    label: "Receive your first report",
    hint: "Open your site with the widget installed and submit a test report.",
  },
])

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
  <div v-if="loading" class="space-y-6" aria-busy="true" aria-label="Loading project overview">
    <div class="h-16 w-1/3 rounded-lg shimmer" />
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <AppLoadingSkeleton v-for="n in 4" :key="n" variant="card" />
    </div>
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <AppLoadingSkeleton variant="table" :rows="4" />
      <AppLoadingSkeleton variant="table" :rows="4" />
    </div>
  </div>
  <div v-else class="space-y-8">
    <!-- Page header -->
    <PageHeader
      eyebrow="Project"
      :title="project?.name ?? '…'"
      description="Snapshot of incoming reports, health, and recent team activity."
    >
      <template #actions>
        <UButton
          :to="`/projects/${projectId}/reports`"
          label="Go to inbox"
          trailing-icon="i-heroicons-arrow-right"
          color="primary"
          size="md"
        />
      </template>
    </PageHeader>

    <!-- Empty allowed-origins list: in production the intake API rejects
         every submission, so this is the #1 "it's installed but nothing
         arrives" cause. Shown regardless of report count. -->
    <UAlert
      v-if="project && !hasOrigins"
      color="warning"
      variant="soft"
      icon="i-heroicons-exclamation-triangle"
      title="No allowed origins — reports will be blocked in production"
      :description="
        isOwner
          ? 'Add the origin of the site that embeds the widget (e.g. https://app.example.com). Until then every submission is rejected outside local development.'
          : 'Ask a project owner to add the origin of the site that embeds the widget. Until then every submission is rejected outside local development.'
      "
      :actions="
        isOwner
          ? [
              {
                label: 'Add an origin',
                to: `/projects/${projectId}/settings`,
                color: 'warning',
                variant: 'solid',
                size: 'sm',
              },
            ]
          : undefined
      "
    />

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

    <!-- Setup checklist + the real embed snippet, until the first report lands -->
    <section v-if="hasNoReports" class="rounded-xl border border-default bg-default">
      <div class="flex items-start justify-between gap-4 px-5 py-4 border-b border-default">
        <div class="flex items-start gap-3 min-w-0">
          <div
            class="flex items-center justify-center size-9 rounded-lg bg-primary/10 text-primary ring-1 ring-primary/15 shrink-0"
          >
            <UIcon name="i-heroicons-code-bracket" class="size-4" />
          </div>
          <div class="min-w-0">
            <h2 class="text-base font-semibold text-default tracking-tight">
              Get set up to receive reports
            </h2>
            <p class="mt-0.5 text-sm text-muted">
              Three steps. The snippet already contains this project's key; prefer a package
              manager? The install guide covers
              <code class="font-mono px-1 rounded bg-muted">init()</code> too.
            </p>
          </div>
        </div>
        <UButton
          :to="installLink.to"
          :label="installLink.label"
          color="neutral"
          variant="outline"
          size="sm"
          trailing-icon="i-heroicons-arrow-right"
          class="shrink-0"
        />
      </div>
      <div class="grid grid-cols-1 lg:grid-cols-12">
        <ol
          class="lg:col-span-4 px-5 py-4 space-y-3 border-b lg:border-b-0 lg:border-r border-default"
        >
          <li v-for="step in setupSteps" :key="step.id" class="flex items-start gap-3">
            <span
              class="mt-0.5 inline-flex items-center justify-center size-5 rounded-full shrink-0 ring-1"
              :class="
                step.done
                  ? 'bg-success/15 text-success ring-success/30'
                  : 'bg-elevated text-muted ring-default'
              "
              aria-hidden="true"
            >
              <UIcon v-if="step.done" name="i-heroicons-check" class="size-3.5" />
              <span v-else class="size-1.5 rounded-full bg-current" />
            </span>
            <div class="min-w-0">
              <div
                class="text-sm font-medium"
                :class="step.done ? 'text-muted line-through decoration-muted/60' : 'text-default'"
              >
                {{ step.label }}
                <span class="sr-only">{{ step.done ? "(done)" : "(to do)" }}</span>
              </div>
              <p class="text-sm text-muted">
                {{ step.hint }}
                <NuxtLink
                  v-if="step.to && !step.done && isOwner"
                  :to="step.to"
                  class="text-primary hover:underline"
                >
                  Open settings →
                </NuxtLink>
              </p>
            </div>
          </li>
        </ol>
        <div class="lg:col-span-8 px-5 py-4">
          <InstallSnippet :project-key="project?.publicKey ?? null" @copied="keyCopied = true" />
        </div>
      </div>
    </section>
  </div>
</template>
