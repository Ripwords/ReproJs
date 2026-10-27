<!-- apps/dashboard/app/components/report-drawer/thread-card.vue
     Every report linked to the same GitHub issue as this one, as a vertical
     thread: the report that opened the issue first, then the attached ones
     oldest first. The current report is highlighted; the others link to their
     own page. Hidden until at least two reports share the issue. -->
<script setup lang="ts">
import RelativeTime from "~/components/common/relative-time.vue"
import type { ReportDetailDTO, ReportThreadDTO } from "@reprojs/shared"
import { safeHref } from "~/composables/use-safe-href"
import { statusColor, statusLabel } from "~/composables/use-report-format"

const props = defineProps<{ projectId: string; report: ReportDetailDTO }>()

// Keyed on the issue number too, so linking or unlinking this report (which
// changes it) refetches the thread.
const { data: thread } = useApi<ReportThreadDTO>(
  () => `/api/projects/${props.projectId}/reports/${props.report.id}/thread`,
  {
    key: computed(
      () => `report-thread-${props.report.id}-${props.report.githubIssueNumber ?? "none"}`,
    ),
    watch: [() => props.report.id, () => props.report.githubIssueNumber],
  },
)

const items = computed(() => thread.value?.items ?? [])
</script>

<template>
  <section
    v-if="thread && thread.issueNumber !== null && items.length > 1"
    class="overflow-hidden rounded-xl ring-1 ring-default bg-default"
    aria-label="Linked reports"
  >
    <header
      class="flex items-center justify-between gap-3 px-5 py-3 bg-primary/[0.08] border-b border-default"
    >
      <h3 class="text-sm font-medium text-primary tracking-tight">
        Thread · {{ items.length }} reports
      </h3>
      <a
        v-if="thread.issueUrl"
        :href="safeHref(thread.issueUrl)"
        target="_blank"
        rel="noopener"
        class="inline-flex items-center gap-1 text-sm text-muted hover:text-default tabular-nums"
      >
        <UIcon name="i-simple-icons-github" class="size-3.5" />
        #{{ thread.issueNumber }}
      </a>
    </header>
    <ol class="px-5 py-4">
      <li v-for="(item, i) in items" :key="item.id" class="relative flex gap-3">
        <!-- Rail: a dot per report, joined by a line down to the next one. -->
        <div class="relative flex w-3 shrink-0 justify-center">
          <span
            v-if="i < items.length - 1"
            class="absolute top-4 bottom-0 w-px bg-(--ui-border-accented)"
            aria-hidden="true"
          />
          <span
            :class="[
              'relative mt-1.5 size-2.5 rounded-full ring-2 ring-(--ui-bg)',
              item.id === report.id ? 'bg-primary' : 'bg-(--ui-border-accented)',
            ]"
            aria-hidden="true"
          />
        </div>
        <div :class="['min-w-0 flex-1', i < items.length - 1 ? 'pb-4' : '']">
          <div class="flex items-center gap-2 min-w-0">
            <span
              v-if="item.id === report.id"
              class="truncate text-sm font-semibold text-default"
              aria-current="page"
            >
              {{ item.title }}
            </span>
            <NuxtLink
              v-else
              :to="`/projects/${projectId}/reports/${item.id}`"
              class="truncate text-sm font-medium text-default hover:text-primary hover:underline"
            >
              {{ item.title }}
            </NuxtLink>
            <span
              v-if="item.githubLinkKind === 'created'"
              class="shrink-0 text-xs text-muted"
              title="Repro opened the GitHub issue for this report"
            >
              opened issue
            </span>
          </div>
          <div class="mt-1 flex items-center gap-2 text-sm text-muted min-w-0">
            <span class="truncate">{{
              item.reporterName ?? item.reporterEmail ?? "anonymous"
            }}</span>
            <span class="text-muted/60">·</span>
            <span class="whitespace-nowrap tabular-nums"
              ><RelativeTime :value="item.receivedAt"
            /></span>
            <UBadge
              :color="statusColor(item.status)"
              variant="soft"
              size="sm"
              class="ml-auto shrink-0 rounded-full"
              :label="statusLabel(item.status)"
            />
          </div>
        </div>
      </li>
    </ol>
  </section>
</template>
