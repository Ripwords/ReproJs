<script setup lang="ts">
import RelativeTime from "~/components/common/relative-time.vue"
import { describeApiError } from "~/utils/api-error"
import type { AppSettingsDTO } from "@reprojs/shared"

definePageMeta({ middleware: "admin-only" })
useHead({ title: "Access" })

const toast = useToast()
const runtimeConfig = useRuntimeConfig()

const { data: settings, pending, refresh } = await useApi<AppSettingsDTO>("/api/settings")

const signupGated = ref(false)
const domainsText = ref("")

// Seed the form from the fetched settings once, and re-seed on every refresh
// so external changes flow back in.
watch(
  settings,
  (next) => {
    if (!next) return
    signupGated.value = next.signupGated
    domainsText.value = next.allowedEmailDomains.join("\n")
  },
  { immediate: true },
)

const parsedDomains = computed(() =>
  domainsText.value
    .split(/[\n,]+/)
    .map((d) => d.trim().toLowerCase())
    .filter((d) => d.length > 0),
)

// A simple-enough regex that matches the server-side Zod rule — the backend
// still validates, but doing it here lets us disable Save for obviously wrong
// input before the round-trip.
const DOMAIN_RE = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/
const invalidDomains = computed(() => parsedDomains.value.filter((d) => !DOMAIN_RE.test(d)))
const tooManyDomains = computed(() => parsedDomains.value.length > 50)

const isDirty = computed(() => {
  if (!settings.value) return false
  if (signupGated.value !== settings.value.signupGated) return true
  const current = parsedDomains.value.toSorted()
  const original = settings.value.allowedEmailDomains.toSorted()
  if (current.length !== original.length) return true
  return current.some((d, i) => d !== original[i])
})

const canSave = computed(
  () => isDirty.value && invalidDomains.value.length === 0 && !tooManyDomains.value,
)

const saving = ref(false)

async function save() {
  if (!canSave.value) return
  saving.value = true
  try {
    await $fetch("/api/settings", {
      method: "PATCH",
      credentials: "include",
      body: {
        signupGated: signupGated.value,
        allowedEmailDomains: parsedDomains.value,
      },
    })
    toast.add({
      title: "Access settings saved",
      color: "success",
      icon: "i-heroicons-check-circle",
    })
    await refresh()
  } catch (err) {
    toast.add({
      title: "Could not save access settings",
      description: describeApiError(err),
      color: "error",
      icon: "i-heroicons-exclamation-triangle",
    })
  } finally {
    saving.value = false
  }
}

function reset() {
  if (!settings.value) return
  signupGated.value = settings.value.signupGated
  domainsText.value = settings.value.allowedEmailDomains.join("\n")
}
</script>

<template>
  <div class="space-y-6 max-w-3xl">
    <header>
      <h1 class="text-2xl font-semibold text-default">Access</h1>
      <p class="text-sm text-muted mt-1">
        Control who can sign in to this install. Changes take effect immediately.
      </p>
    </header>

    <div v-if="pending" class="rounded-xl border border-default bg-default p-6">
      <div class="h-4 w-48 bg-muted rounded animate-pulse mb-3" />
      <div class="h-3 w-72 bg-muted/60 rounded animate-pulse" />
    </div>

    <template v-else-if="settings">
      <UCard>
        <template #header>
          <div class="flex items-start justify-between gap-4">
            <div class="min-w-0">
              <h2 class="text-base font-semibold text-default">Sign-up gate</h2>
              <p class="mt-1 text-sm text-muted">
                When enabled, a new user can only sign up if an admin has invited them. People who
                already have an account can still sign in.
              </p>
            </div>
            <USwitch v-model="signupGated" size="lg" />
          </div>
        </template>

        <div class="space-y-2">
          <UFormField label="Allowed email domains">
            <UTextarea
              v-model="domainsText"
              placeholder="acme.com&#10;example.org"
              :rows="5"
              class="w-full font-mono text-sm"
            />
          </UFormField>

          <p class="text-sm text-muted leading-relaxed">
            One domain per line (or comma-separated). When the list isn't empty, only emails on
            these domains can sign in or be invited, whether or not the sign-up gate is on. People
            already on another domain are refused at their next sign-in. Leave blank to allow any
            domain.
          </p>

          <div v-if="invalidDomains.length > 0" class="flex items-start gap-2 text-sm text-error">
            <UIcon name="i-heroicons-exclamation-triangle" class="size-4 flex-shrink-0 mt-0.5" />
            <div>
              Invalid domain{{ invalidDomains.length === 1 ? "" : "s" }}:
              <span class="font-mono">{{ invalidDomains.join(", ") }}</span>
            </div>
          </div>
          <div v-if="tooManyDomains" class="flex items-start gap-2 text-sm text-error">
            <UIcon name="i-heroicons-exclamation-triangle" class="size-4 flex-shrink-0 mt-0.5" />
            <div>At most 50 domains are allowed.</div>
          </div>
        </div>

        <template #footer>
          <div class="flex items-center justify-between gap-3">
            <span class="text-sm text-muted">
              Last updated <RelativeTime :value="settings.updatedAt" />
            </span>
            <div class="flex gap-2">
              <UButton
                label="Reset"
                color="neutral"
                variant="ghost"
                :disabled="!isDirty || saving"
                @click="reset"
              />
              <UButton
                label="Save changes"
                color="primary"
                :loading="saving"
                :disabled="!canSave"
                @click="save"
              />
            </div>
          </div>
        </template>
      </UCard>
    </template>
  </div>
</template>
