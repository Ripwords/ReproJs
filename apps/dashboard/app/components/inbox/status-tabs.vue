<!--
  Status filter tabs above the inbox table. Each tab is a label + count; the
  active tab gets a teal underline + teal label, and its count sits in a
  soft teal chip. Inactive tabs show a muted-chip count so it's clearly a
  number, not a stray character. No UBadge — the built-in `xs` badge was
  too tiny to register as "this is a count". Counts use `tabular-nums` so
  they don't jitter as filters change.
-->
<script setup lang="ts">
import type { ReportStatus } from "@reprojs/shared"
import { REPORT_STATUSES, statusLabel } from "~/composables/use-report-format"

interface Props {
  selected: ReportStatus[]
  counts: Record<ReportStatus, number>
  total: number
}

const props = defineProps<Props>()
const emit = defineEmits<{ change: [ReportStatus[]] }>()

type TabKey = "all" | ReportStatus

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "all", label: "All" },
  ...REPORT_STATUSES.map((s) => ({ key: s, label: statusLabel(s) })),
]

function isActive(key: TabKey): boolean {
  if (key === "all") return props.selected.length === 0
  return props.selected.length === 1 && props.selected[0] === key
}

function countFor(key: TabKey): number {
  return key === "all" ? props.total : (props.counts[key] ?? 0)
}

function onClick(key: TabKey) {
  emit("change", key === "all" ? [] : [key])
}
</script>

<template>
  <nav
    class="flex items-center gap-6 border-b border-default text-sm"
    role="tablist"
    aria-label="Filter by status"
  >
    <button
      v-for="t in TABS"
      :key="t.key"
      type="button"
      role="tab"
      :aria-selected="isActive(t.key)"
      class="relative inline-flex items-center gap-2 py-3 -mb-px transition-colors"
      :class="
        isActive(t.key) ? 'text-default font-semibold' : 'text-muted hover:text-default font-medium'
      "
      @click="onClick(t.key)"
    >
      <span>{{ t.label }}</span>
      <span
        class="inline-flex items-center justify-center min-w-6 px-1.5 h-5 rounded-md text-sm font-semibold tabular-nums transition-colors"
        :class="isActive(t.key) ? 'bg-elevated text-default' : 'bg-elevated/60 text-muted'"
      >
        {{ countFor(t.key) }}
      </span>
      <!-- Active-tab underline at the baseline — no solid color bar,
           just a subtle white-tinted rule that extends slightly past
           the label for a clean dropped baseline. -->
      <span
        v-if="isActive(t.key)"
        class="absolute left-0 right-0 -bottom-px h-px bg-default"
        aria-hidden="true"
      />
    </button>
  </nav>
</template>
