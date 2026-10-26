<!--
  Global error page. Nuxt renders this for any unhandled error (a 404 on an
  unknown route, a thrown createError in a page, a server-side crash) in
  place of app.vue. Kept deliberately simple and dependency-light: the app
  layout itself may be what failed, so this renders its own shell and never
  touches session or project state.
-->
<script setup lang="ts">
import type { NuxtError } from "#app"

const props = defineProps<{ error: NuxtError }>()

const statusCode = computed(() => props.error.statusCode ?? 500)
const isNotFound = computed(() => statusCode.value === 404)

const title = computed(() => (isNotFound.value ? "Page not found" : "Something went wrong"))
const message = computed(() => {
  if (isNotFound.value) {
    return "The page you're looking for doesn't exist or has moved."
  }
  const m = props.error.statusMessage || props.error.message
  return m && m.length < 200 ? m : "An unexpected error occurred. Please try again."
})

useHead({ title: () => `${title.value} · Repro` })

function goHome() {
  // clearError resets Nuxt's error state and navigates in one step.
  void clearError({ redirect: "/" })
}
function retry() {
  if (import.meta.client) window.location.reload()
}
</script>

<template>
  <UApp>
    <div class="app-grain min-h-screen flex items-center justify-center bg-muted text-default p-6">
      <div class="w-full max-w-md text-center fade-up">
        <div
          class="mx-auto flex items-center justify-center size-14 rounded-2xl ring-1 mb-5"
          :class="
            isNotFound
              ? 'bg-elevated text-muted ring-default'
              : 'bg-error/10 text-error ring-error/20'
          "
        >
          <UIcon
            :name="isNotFound ? 'i-heroicons-map' : 'i-heroicons-exclamation-triangle'"
            class="size-7"
          />
        </div>
        <p class="text-sm font-semibold uppercase tracking-[0.14em] text-muted tabular-nums">
          {{ statusCode }}
        </p>
        <h1 class="mt-1 text-2xl font-semibold tracking-tight">{{ title }}</h1>
        <p class="mt-2 text-sm text-muted leading-relaxed">{{ message }}</p>
        <div class="mt-6 flex items-center justify-center gap-2">
          <UButton label="Back to projects" color="primary" @click="goHome" />
          <UButton
            v-if="!isNotFound"
            label="Try again"
            color="neutral"
            variant="outline"
            @click="retry"
          />
        </div>
      </div>
    </div>
  </UApp>
</template>
