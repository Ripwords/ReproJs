<!-- apps/dashboard/app/components/report-drawer/tabs.vue -->
<script setup lang="ts">
interface Tab {
  id: string
  label: string
  hasData?: boolean
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
        v-if="tab.hasData"
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
