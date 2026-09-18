<!--
  The header every app page opens with: a small uppercase eyebrow naming the
  area (Workspace / Project / Admin / Account), the page title, an optional
  one-line description, and optional actions on the right.
  Standalone auth-style pages (sign-in, invitations) use their own centred
  layout and don't use this.
-->
<script setup lang="ts">
defineProps<{
  eyebrow: string
  title: string
  description?: string
}>()
</script>

<template>
  <header class="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
    <div class="min-w-0 flex-1">
      <div class="text-sm font-medium uppercase tracking-[0.18em] text-muted">{{ eyebrow }}</div>
      <h1 class="mt-1 text-3xl font-semibold text-default tracking-tight truncate">
        {{ title }}
      </h1>
      <p v-if="description || $slots.description" class="mt-1.5 text-sm text-muted max-w-2xl">
        <slot name="description">{{ description }}</slot>
      </p>
    </div>
    <div v-if="$slots.actions" class="flex shrink-0 items-center gap-2">
      <slot name="actions" />
    </div>
  </header>
</template>
