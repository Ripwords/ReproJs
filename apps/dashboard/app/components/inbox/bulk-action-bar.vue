<!-- apps/dashboard/app/components/inbox/bulk-action-bar.vue -->
<script setup lang="ts">
import type { ReportStatus } from "@reprojs/shared"
import { REPORT_STATUSES, statusLabel } from "~/composables/use-report-format"

interface AssigneeOption {
  value: string | null
  label: string
}
interface Props {
  count: number
  assigneeOptions: AssigneeOption[]
  submitting: boolean
}
const props = defineProps<Props>()
const emit = defineEmits<{
  status: [ReportStatus]
  assign: [string | null]
  clear: []
}>()

function statusIcon(s: ReportStatus): string {
  switch (s) {
    case "open":
      return "i-heroicons-inbox"
    case "in_progress":
      return "i-heroicons-arrow-path"
    case "resolved":
      return "i-heroicons-check-circle"
    case "closed":
      return "i-heroicons-x-circle"
  }
}

const statusItems = computed(() => [
  REPORT_STATUSES.map((s) => ({
    label: statusLabel(s),
    icon: statusIcon(s),
    onSelect: () => emit("status", s),
  })),
])

const assignItems = computed(() => [
  props.assigneeOptions.map((opt) => ({
    label: opt.label,
    onSelect: () => emit("assign", opt.value),
  })),
])
</script>

<template>
  <div
    class="flex items-center gap-2 rounded-lg border border-default bg-elevated px-3 py-2 text-sm"
  >
    <UBadge :label="`${count} selected`" color="primary" variant="soft" size="sm" />

    <div class="flex items-center gap-1 ml-2">
      <UDropdownMenu :items="statusItems">
        <UButton
          label="Set status"
          icon="i-heroicons-flag"
          trailing-icon="i-heroicons-chevron-down"
          color="neutral"
          variant="outline"
          size="sm"
          :loading="submitting"
          :disabled="submitting"
        />
      </UDropdownMenu>

      <UDropdownMenu :items="assignItems">
        <UButton
          label="Assign"
          icon="i-heroicons-user"
          trailing-icon="i-heroicons-chevron-down"
          color="neutral"
          variant="outline"
          size="sm"
          :loading="submitting"
          :disabled="submitting"
        />
      </UDropdownMenu>
    </div>

    <div class="flex-1" />

    <UButton
      label="Clear"
      icon="i-heroicons-x-mark"
      color="neutral"
      variant="ghost"
      size="sm"
      :disabled="submitting"
      @click="emit('clear')"
    />
  </div>
</template>
