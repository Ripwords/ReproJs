<script setup lang="ts">
import { computed } from "vue"
import AppProjectSwitcher from "./project-switcher.vue"
import AppThemeToggle from "./theme-toggle.vue"

const { session, signOut } = useSession()

const email = computed(() => session.value?.data?.user?.email ?? "")

const userItems = computed(() => [
  [
    {
      label: "Account",
      icon: "i-heroicons-user",
      to: "/settings/account",
    },
    {
      label: "AI assistants (MCP)",
      icon: "i-heroicons-cpu-chip",
      to: "/settings/mcp",
    },
  ],
  [
    {
      label: "Sign out",
      icon: "i-heroicons-arrow-right-on-rectangle",
      onSelect: () => signOut(),
    },
  ],
])
</script>

<template>
  <header class="h-12 flex items-center justify-between px-4 border-b border-default bg-default">
    <AppProjectSwitcher />
    <div class="flex items-center gap-1">
      <UButton
        icon="i-heroicons-question-mark-circle"
        to="https://ripwords.github.io/ReproJs/"
        target="_blank"
        color="neutral"
        variant="ghost"
        size="sm"
        aria-label="Help"
      />
      <AppThemeToggle />
      <UDropdownMenu :items="userItems">
        <UButton
          color="neutral"
          variant="ghost"
          size="sm"
          :label="email"
          trailing-icon="i-heroicons-chevron-down"
        />
      </UDropdownMenu>
    </div>
  </header>
</template>
