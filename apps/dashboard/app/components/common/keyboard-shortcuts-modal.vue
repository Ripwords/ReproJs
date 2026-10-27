<script setup lang="ts">
interface Shortcut {
  keys: string[]
  label: string
}

interface Props {
  open: boolean
  shortcuts: Shortcut[]
}

defineProps<Props>()
defineEmits<{ "update:open": [boolean] }>()
</script>

<template>
  <!-- `title` gives the dialog its accessible name; Nuxt UI renders it
       visually hidden when the #content slot is used. -->
  <UModal
    :open="open"
    title="Keyboard shortcuts"
    description="Shortcuts available on the inbox and report pages."
    :ui="{ content: 'max-w-md' }"
    @update:open="(v) => $emit('update:open', v)"
  >
    <template #content>
      <div class="p-6">
        <h3 class="text-lg font-semibold text-default mb-4">Keyboard shortcuts</h3>
        <ul class="space-y-2">
          <li
            v-for="s in shortcuts"
            :key="s.label"
            class="flex items-center justify-between text-sm"
          >
            <span class="text-muted">{{ s.label }}</span>
            <span class="flex gap-1">
              <UKbd v-for="k in s.keys" :key="k">{{ k }}</UKbd>
            </span>
          </li>
        </ul>
      </div>
    </template>
  </UModal>
</template>
