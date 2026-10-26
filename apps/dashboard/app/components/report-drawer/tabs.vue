<!-- apps/dashboard/app/components/report-drawer/tabs.vue -->
<script setup lang="ts">
interface Tab {
  id: string
  label: string
  /** Something is in this tab, but how much is not known yet (lazy-loaded). */
  hasData?: boolean
  /** Number of entries in this tab; shown as a badge and read by screen readers. */
  count?: number
}

interface Props {
  modelValue: string
  tabs: Tab[]
}

defineProps<Props>()
const emit = defineEmits<{ "update:modelValue": [string] }>()
</script>

<template>
  <nav class="flex overflow-x-auto">
    <button
      v-for="(tab, index) in tabs"
      :key="tab.id"
      type="button"
      :aria-keyshortcuts="tabShortcutKey(index) ?? undefined"
      :class="[
        'relative px-4 h-11 text-sm whitespace-nowrap transition-colors -mb-px',
        modelValue === tab.id
          ? 'text-default font-semibold'
          : 'text-muted hover:text-default font-medium',
      ]"
      @click="emit('update:modelValue', tab.id)"
    >
      {{ tab.label }}
      <span
        v-if="tab.count !== undefined && tab.count > 0"
        class="inline-flex items-center justify-center ml-1.5 min-w-5 px-1 h-4.5 rounded-md text-xs font-semibold tabular-nums"
        :class="modelValue === tab.id ? 'bg-elevated text-default' : 'bg-elevated/60 text-muted'"
      >
        {{ tab.count > 999 ? "999+" : tab.count }}
        <span class="sr-only">entries</span>
      </span>
      <span
        v-else-if="tab.hasData && tab.count === undefined"
        class="inline-block ml-1.5 size-1.5 rounded-full bg-muted/70"
        aria-hidden="true"
      />
      <span
        v-if="modelValue === tab.id"
        class="absolute left-3 right-3 bottom-0 h-px bg-default"
        aria-hidden="true"
      />
    </button>
  </nav>
</template>
