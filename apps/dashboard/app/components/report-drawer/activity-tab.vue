<!-- apps/dashboard/app/components/report-drawer/activity-tab.vue -->
<script setup lang="ts">
import RelativeTime from "~/components/common/relative-time.vue"
import { priorityLabel, statusLabel } from "~/composables/use-report-format"
import type { ReportEventDTO, ReportSummaryDTO } from "@reprojs/shared"

interface Props {
  projectId: string
  report: ReportSummaryDTO
}
const props = defineProps<Props>()

const { data, refresh } = useApi<{ items: ReportEventDTO[]; total: number }>(
  `/api/projects/${props.projectId}/reports/${props.report.id}/events?limit=50`,
)

defineExpose({ refresh })

function summary(e: ReportEventDTO): string {
  const p = e.payload as Record<string, unknown>
  switch (e.kind) {
    case "status_changed":
      return `changed status ${statusLabel(String(p.from))} → ${statusLabel(String(p.to))}`
    case "priority_changed":
      return `set priority ${priorityLabel(String(p.to))} (was ${priorityLabel(String(p.from))})`
    case "assignee_changed": {
      const from = p.from ? "someone" : "nobody"
      const to = p.to ? "someone" : "nobody"
      return `reassigned from ${from} to ${to}`
    }
    case "assignee_added":
      return `assigned @${String(p.githubLogin ?? "?")}`
    case "assignee_removed":
      return `unassigned @${String(p.githubLogin ?? "?")}`
    case "tag_added": {
      const name = p.name ?? p.tag
      return `added label ${String(name ?? "")}`.trim()
    }
    case "tag_removed": {
      const name = p.name ?? p.tag
      return `removed label ${String(name ?? "")}`.trim()
    }
    default:
      return e.kind
  }
}
function actorLabel(e: ReportEventDTO): string {
  return e.actor?.name ?? e.actor?.email ?? "System"
}
function actorInitials(e: ReportEventDTO): string {
  return actorLabel(e).slice(0, 2).toUpperCase()
}
</script>

<template>
  <div class="p-5 text-sm">
    <div v-if="!data?.items?.length" class="text-muted">No activity yet.</div>
    <ul v-else class="space-y-3">
      <li v-for="e in data.items" :key="e.id" class="flex items-start gap-3">
        <UAvatar :text="actorInitials(e)" size="sm" class="flex-shrink-0" />
        <div class="flex-1 min-w-0">
          <div class="text-default">
            <span class="font-medium">{{ actorLabel(e) }}</span>
            <span>&nbsp;</span>
            <span class="text-muted">{{ summary(e) }}</span>
          </div>
          <div class="text-sm text-muted mt-0.5"><RelativeTime :value="e.createdAt" /></div>
        </div>
      </li>
    </ul>
  </div>
</template>
