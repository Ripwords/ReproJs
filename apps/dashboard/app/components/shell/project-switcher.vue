<!--
  Top-bar label + entry point for the global command palette. Clicking it
  opens the same palette as ⌘K / Ctrl+K, so the switcher, the keyboard
  shortcut, and any other future entry points all share one UI. The label
  reflects the current project when inside a project route, and falls back
  to the product name on the index / admin pages.
-->
<script setup lang="ts">
import { computed } from "vue"
import { useRoute } from "vue-router"

const route = useRoute()
const { openPalette } = useCommandPalette()

// Shared projects-list cache (same key as the sidebar, palette and
// projects page), so a rename shows here without a reload.
const { data } = await useProjectsList()

const currentProjectId = computed(() => {
  const m = /^\/projects\/([^/]+)/.exec(route.path)
  return m ? m[1] : null
})

const currentProject = computed(
  () => data.value?.find((p) => p.id === currentProjectId.value) ?? null,
)

const isMac = computed(() => typeof navigator !== "undefined" && /mac/i.test(navigator.platform))
const shortcutHint = computed(() => (isMac.value ? "⌘K" : "Ctrl K"))
</script>

<template>
  <UButton
    color="neutral"
    variant="ghost"
    size="sm"
    trailing-icon="i-heroicons-chevron-down"
    @click="openPalette"
  >
    <span class="truncate max-w-[14rem]">{{ currentProject?.name ?? "Repro" }}</span>
    <!-- navigator.platform isn't available during SSR (renders "Ctrl K")
         but becomes available post-mount (re-renders as "⌘K" on Mac),
         which triggers Vue's hydration-mismatch warning. ClientOnly skips
         server-rendering this tiny element entirely — visually silent
         since SSR wouldn't render the right value anyway. -->
    <ClientOnly>
      <kbd
        class="hidden md:inline-flex items-center ml-2 px-1.5 py-0.5 rounded border border-default bg-muted/60 text-sm font-mono text-muted"
        aria-hidden="true"
      >
        {{ shortcutHint }}
      </kbd>
    </ClientOnly>
  </UButton>
</template>
