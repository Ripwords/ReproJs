<script setup lang="ts">
import { describeApiError } from "~/utils/api-error"
import type { InvitationDetailDTO } from "@reprojs/shared"
import { signInPathFor } from "~~/shared/auth-redirect"

// $fetch in SSR does NOT forward the incoming request's cookies even with
// `credentials: "include"` — that option is a browser concept. The server
// call then hits requireSession with no session and 401s, we catch and
// navigateTo, and navigateTo's internal useNuxtApp() occasionally loses
// its AsyncLocalStorage context across the await boundary and throws
// "[nuxt] instance unavailable" (surfaced as a 500 Server Error to the
// user). Use useRequestFetch so cookies forward on SSR, and wrap the
// post-await navigateTo in runWithContext so the context is preserved
// regardless of how the awaits chain.
const route = useRoute()
const token = computed(() => String(route.params.token))
const toast = useToast()
const { signOut } = useSession()
const nuxtApp = useNuxtApp()
const requestFetch = useRequestFetch()

const invite = ref<InvitationDetailDTO | null>(null)
const errorCode = ref<"email_mismatch" | "expired" | "revoked" | "accepted" | "not_found" | null>(
  null,
)
const pending = ref(true)
const submitting = ref(false)

useHead({ title: "Accept invitation" })

async function load() {
  pending.value = true
  try {
    invite.value = await requestFetch<InvitationDetailDTO>(`/api/invitations/${token.value}`)
  } catch (err: unknown) {
    const status = (err as { statusCode?: number }).statusCode
    if (status === 401) {
      await nuxtApp.runWithContext(() => navigateTo(signInPathFor(`/invitations/${token.value}`)))
      return
    }
    if (status === 409) {
      const msg = (err as { statusMessage?: string }).statusMessage
      if (msg === "expired" || msg === "revoked" || msg === "already_accepted") {
        errorCode.value = msg === "already_accepted" ? "accepted" : msg
      } else {
        errorCode.value = "not_found"
      }
      return
    }
    if (status === 404) errorCode.value = "not_found"
    else if (status === 403) errorCode.value = "email_mismatch"
    else errorCode.value = "not_found"
  } finally {
    pending.value = false
  }
}
await load()

async function accept() {
  submitting.value = true
  try {
    const res = await requestFetch<{ projectId: string; role: string }>(
      `/api/invitations/${token.value}/accept`,
      { method: "POST" },
    )
    // Blow away any cached useFetch data — the user's membership just
    // changed, and the project list + sidebar queries need to re-run so the
    // newly-joined project actually appears. Without this, navigating to /
    // after acceptance shows a stale list from before the membership insert.
    await clearNuxtData()
    toast.add({ title: "Invitation accepted", color: "success", icon: "i-heroicons-check-circle" })
    await nuxtApp.runWithContext(() => navigateTo(`/projects/${res.projectId}`))
  } catch (err: unknown) {
    const status = (err as { statusCode?: number }).statusCode
    const msg = (err as { statusMessage?: string }).statusMessage ?? ""
    if (status === 403 && msg === "email_mismatch") errorCode.value = "email_mismatch"
    else if (status === 409 && msg === "expired") errorCode.value = "expired"
    else if (status === 409 && msg === "revoked") errorCode.value = "revoked"
    else
      toast.add({
        title: "Could not accept invitation",
        description: msg,
        color: "error",
        icon: "i-heroicons-exclamation-triangle",
      })
  } finally {
    submitting.value = false
  }
}

async function decline() {
  submitting.value = true
  try {
    await requestFetch(`/api/invitations/${token.value}/decline`, { method: "POST" })
    await nuxtApp.runWithContext(() => navigateTo("/"))
  } catch (err: unknown) {
    toast.add({
      title: "Could not decline",
      description: describeApiError(err),
      color: "error",
    })
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="max-w-md mx-auto p-6 mt-16">
    <UCard v-if="pending">
      <p class="text-sm text-muted">Loading invitation…</p>
    </UCard>

    <UCard v-else-if="errorCode === 'email_mismatch'">
      <h1 class="text-xl font-semibold mb-2">Wrong account</h1>
      <p class="text-sm text-muted mb-4">
        This invitation was sent to a different email. Please sign out and sign in as the invited
        address.
      </p>
      <UButton
        label="Sign out"
        @click="signOut({ redirectTo: signInPathFor(`/invitations/${token}`) })"
      />
    </UCard>

    <UCard v-else-if="errorCode === 'expired'">
      <h1 class="text-xl font-semibold mb-2">This invitation expired</h1>
      <p class="text-sm text-muted">Ask the inviter to resend it.</p>
    </UCard>

    <UCard v-else-if="errorCode === 'revoked'">
      <h1 class="text-xl font-semibold mb-2">This invitation is no longer valid</h1>
      <p class="text-sm text-muted">It was revoked or declined.</p>
    </UCard>

    <UCard v-else-if="errorCode === 'accepted'">
      <h1 class="text-xl font-semibold mb-2">Invitation already accepted</h1>
      <p class="text-sm text-muted">You've already joined this project.</p>
    </UCard>

    <UCard v-else-if="errorCode === 'not_found'">
      <h1 class="text-xl font-semibold mb-2">Invitation not found</h1>
    </UCard>

    <UCard v-else-if="invite">
      <h1 class="text-xl font-semibold mb-2">Join {{ invite.projectName }}</h1>
      <p class="text-sm text-muted mb-4">
        {{ invite.inviterName ?? invite.inviterEmail }} invited you to join as
        <strong>{{ invite.role }}</strong
        >.
      </p>
      <div class="flex justify-end gap-2">
        <UButton
          label="Decline"
          color="neutral"
          variant="ghost"
          :loading="submitting"
          @click="decline"
        />
        <UButton label="Accept" color="primary" :loading="submitting" @click="accept" />
      </div>
    </UCard>
  </div>
</template>
