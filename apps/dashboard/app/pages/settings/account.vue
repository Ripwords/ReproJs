<script setup lang="ts">
import PageHeader from "~/components/common/page-header.vue"
import { describeApiError } from "~/utils/api-error"
import { computed, ref } from "vue"

useHead({ title: "Account" })

const { user, role: sessionRole, signOut } = useSession()
const toast = useToast()
const { confirm } = useConfirm()

const email = computed(() => user.value?.email ?? "")
const name = computed(() => user.value?.name ?? "")
const role = computed(() => sessionRole.value ?? "")

const signingOutOthers = ref(false)

async function signOutOtherSessions() {
  const ok = await confirm({
    title: "Sign out other sessions?",
    description: "Other devices will have to sign in again.",
    confirmLabel: "Sign out others",
    confirmColor: "warning",
    icon: "i-heroicons-arrow-right-on-rectangle",
  })
  if (!ok) return
  signingOutOthers.value = true
  try {
    await $fetch("/api/auth/revoke-other-sessions", {
      method: "POST",
      credentials: "include",
    })
    toast.add({
      title: "Other sessions signed out",
      color: "success",
      icon: "i-heroicons-check-circle",
    })
  } catch (err) {
    toast.add({
      title: "Could not sign out other sessions",
      description: describeApiError(err),
      color: "error",
      icon: "i-heroicons-exclamation-triangle",
    })
  } finally {
    signingOutOthers.value = false
  }
}
</script>

<template>
  <div class="space-y-6 max-w-3xl">
    <PageHeader
      eyebrow="Account"
      title="Account"
      description="Your profile and sign-in sessions."
    />

    <UCard>
      <template #header>
        <h2 class="text-base font-semibold text-default">Profile</h2>
      </template>
      <div class="space-y-4">
        <UFormField label="Email">
          <UInput :model-value="email" readonly class="w-full" />
        </UFormField>
        <UFormField label="Name">
          <UInput :model-value="name" readonly class="w-full" />
        </UFormField>
        <UFormField label="Role">
          <UInput :model-value="role" readonly class="w-full" />
        </UFormField>
      </div>
    </UCard>

    <UCard>
      <template #header>
        <h2 class="text-base font-semibold text-default">Sessions</h2>
      </template>
      <div class="space-y-3">
        <p class="text-sm text-muted">
          Signing out of other sessions forces anyone signed in as you on a different device or
          browser to sign back in. Your current session stays active.
        </p>
        <div class="flex justify-end">
          <UButton
            label="Sign out all other sessions"
            color="warning"
            variant="soft"
            :loading="signingOutOthers"
            @click="signOutOtherSessions"
          />
        </div>
      </div>
    </UCard>

    <UCard>
      <template #header>
        <h2 class="text-base font-semibold text-default">Sign out</h2>
      </template>
      <div class="flex items-center justify-between gap-4">
        <p class="text-sm text-muted">Sign out of this session.</p>
        <UButton label="Sign out" color="error" variant="soft" @click="signOut()" />
      </div>
    </UCard>
  </div>
</template>
