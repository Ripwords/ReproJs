<!--
  Faceted filter sidebar for the inbox. Renders Assignee / Priority / Labels
  sections, each a list of togglable rows with a live count.

  Visual treatment:
    - Section labels are eyebrow caps with wide tracking, separated from
      rows by breathing room (not a border) — matches the rest of the app.
    - Rows are flex label/count pairs; hover lights the background, active
      state lights it teal and tints the label + adds a teal leading
      indicator. No UButton / no UBadge — the tiny pills in the old
      version read as "form widget" rather than "filter". Plain tabular
      numerals read as data.
    - Counts in tabular-nums so 11-digit counters (realistic for inboxes)
      don't dance as filters change.
-->
<script setup lang="ts">
import type { ReportPriority } from "@reprojs/shared"
import { REPORT_PRIORITIES, priorityLabel } from "~/composables/use-report-format"

interface Assignee {
  login: string
  avatarUrl: string | null
  count: number
}

interface Props {
  priorityCounts: Record<ReportPriority, number>
  assignees: Assignee[]
  tags: Array<{ name: string; count: number }>
  sourceCounts: { web: number; expo: number; ios: number; android: number }
  selectedPriority: ReportPriority[]
  selectedAssignee: string[]
  selectedTags: string[]
  selectedSource: string[]
}

const props = defineProps<Props>()
const emit = defineEmits<{
  priority: [ReportPriority[]]
  assignee: [string[]]
  tag: [string[]]
  source: [string[]]
}>()

const PRIORITIES = REPORT_PRIORITIES

function togglePriority(p: ReportPriority) {
  const has = props.selectedPriority.includes(p)
  emit(
    "priority",
    has ? props.selectedPriority.filter((x) => x !== p) : [...props.selectedPriority, p],
  )
}
function toggleAssignee(token: string) {
  const has = props.selectedAssignee.includes(token)
  emit(
    "assignee",
    has ? props.selectedAssignee.filter((x) => x !== token) : [...props.selectedAssignee, token],
  )
}
function toggleTag(name: string) {
  const has = props.selectedTags.includes(name)
  emit("tag", has ? props.selectedTags.filter((x) => x !== name) : [...props.selectedTags, name])
}
function toggleSource(token: string) {
  const has = props.selectedSource.includes(token)
  emit(
    "source",
    has ? props.selectedSource.filter((x) => x !== token) : [...props.selectedSource, token],
  )
}

function isAssigneeSelected(a: Assignee): boolean {
  return props.selectedAssignee.includes(a.login)
}
function assigneeToken(a: Assignee): string {
  return a.login
}
function assigneeLabel(a: Assignee): string {
  return `@${a.login}`
}

const sourceItems = computed(() => [
  { token: "web", label: "Web", count: props.sourceCounts.web },
  { token: "ios", label: "iOS", count: props.sourceCounts.ios },
  { token: "android", label: "Android", count: props.sourceCounts.android },
])

// Priority rows get a colored leading dot (urgent=red, high=orange,
// normal=teal, low=muted). That single dot carries more signal than a
// pill badge and pairs visually with the priority column in the table.
const priorityDot: Record<ReportPriority, string> = {
  urgent: "bg-error",
  high: "bg-warning",
  normal: "bg-primary/70",
  low: "bg-muted-foreground/40",
}
</script>

<template>
  <aside class="space-y-7 text-sm">
    <section>
      <h3 class="px-2 mb-2 text-sm font-semibold uppercase tracking-[0.14em] text-muted">
        Assignee
      </h3>
      <ul>
        <li v-for="a in assignees" :key="a.login">
          <button
            type="button"
            :aria-pressed="isAssigneeSelected(a)"
            class="group w-full flex items-center gap-2 rounded-lg px-2.5 py-1.5 transition-colors"
            :class="
              isAssigneeSelected(a)
                ? 'bg-elevated text-default font-semibold'
                : 'text-muted hover:text-default hover:bg-elevated/60'
            "
            @click="toggleAssignee(assigneeToken(a))"
          >
            <span
              class="size-1.5 rounded-full"
              :class="
                isAssigneeSelected(a) ? 'bg-primary' : 'bg-transparent group-hover:bg-muted/60'
              "
              aria-hidden="true"
            />
            <span class="flex-1 truncate text-left font-medium">{{ assigneeLabel(a) }}</span>
            <span
              class="text-sm font-medium tabular-nums"
              :class="isAssigneeSelected(a) ? 'text-primary' : 'text-muted'"
            >
              {{ a.count }}
            </span>
          </button>
        </li>
      </ul>
    </section>

    <section>
      <h3 class="px-2 mb-2 text-sm font-semibold uppercase tracking-[0.14em] text-muted">
        Priority
      </h3>
      <ul>
        <li v-for="p in PRIORITIES" :key="p">
          <button
            type="button"
            :aria-pressed="selectedPriority.includes(p)"
            class="group w-full flex items-center gap-2 rounded-lg px-2.5 py-1.5 transition-colors"
            :class="
              selectedPriority.includes(p)
                ? 'bg-elevated text-default font-semibold'
                : 'text-muted hover:text-default hover:bg-elevated/60'
            "
            @click="togglePriority(p)"
          >
            <span
              class="size-1.5 rounded-full shrink-0"
              :class="priorityDot[p]"
              aria-hidden="true"
            />
            <span class="flex-1 text-left font-medium">{{ priorityLabel(p) }}</span>
            <span
              class="text-sm font-medium tabular-nums"
              :class="selectedPriority.includes(p) ? 'text-primary' : 'text-muted'"
            >
              {{ priorityCounts[p] ?? 0 }}
            </span>
          </button>
        </li>
      </ul>
    </section>

    <section v-if="tags.length">
      <h3 class="px-2 mb-2 text-sm font-semibold uppercase tracking-[0.14em] text-muted">Labels</h3>
      <ul>
        <li v-for="t in tags" :key="t.name">
          <button
            type="button"
            :aria-pressed="selectedTags.includes(t.name)"
            class="group w-full flex items-center gap-2 rounded-lg px-2.5 py-1.5 transition-colors"
            :class="
              selectedTags.includes(t.name)
                ? 'bg-elevated text-default font-semibold'
                : 'text-muted hover:text-default hover:bg-elevated/60'
            "
            @click="toggleTag(t.name)"
          >
            <UIcon
              name="i-heroicons-hashtag"
              class="size-3.5 shrink-0"
              :class="selectedTags.includes(t.name) ? 'text-primary' : 'text-muted'"
            />
            <span class="flex-1 truncate text-left font-medium">{{ t.name }}</span>
            <span
              class="text-sm font-medium tabular-nums"
              :class="selectedTags.includes(t.name) ? 'text-primary' : 'text-muted'"
            >
              {{ t.count }}
            </span>
          </button>
        </li>
      </ul>
    </section>

    <section>
      <h3 class="px-2 mb-2 text-sm font-semibold uppercase tracking-[0.14em] text-muted">Source</h3>
      <ul>
        <li v-for="item in sourceItems" :key="item.token">
          <button
            type="button"
            :aria-pressed="selectedSource.includes(item.token)"
            class="group w-full flex items-center gap-2 rounded-lg px-2.5 py-1.5 transition-colors"
            :class="
              selectedSource.includes(item.token)
                ? 'bg-elevated text-default font-semibold'
                : 'text-muted hover:text-default hover:bg-elevated/60'
            "
            @click="toggleSource(item.token)"
          >
            <span
              class="size-1.5 rounded-full shrink-0"
              :class="
                selectedSource.includes(item.token)
                  ? 'bg-primary'
                  : 'bg-transparent group-hover:bg-muted/60'
              "
              aria-hidden="true"
            />
            <span class="flex-1 text-left font-medium">{{ item.label }}</span>
            <span
              class="text-sm font-medium tabular-nums"
              :class="selectedSource.includes(item.token) ? 'text-primary' : 'text-muted'"
            >
              {{ item.count }}
            </span>
          </button>
        </li>
      </ul>
    </section>
  </aside>
</template>
