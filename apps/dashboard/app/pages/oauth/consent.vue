<script setup lang="ts">
import { computed, ref } from "vue"
import { useRoute } from "#imports"

// Auth is enforced by auth.global.ts middleware — no definePageMeta needed.

useHead({ title: "Authorize access" })

const route = useRoute()
const clientName = computed(() => String(route.query.client_name ?? "An MCP client"))
const scope = computed(() => String(route.query.scope ?? ""))

// The full signed query string from the OAuth redirect (includes client_id,
// redirect_uri, state, code_challenge, exp, sig, etc.). We forward it to
// better-auth's /api/auth/oauth2/consent endpoint as oauth_query so it can
// verify the signature and restore the OAuth flow state.
const oauthQuery = computed(() => {
  const params = new URLSearchParams()
  for (const [key, val] of Object.entries(route.query)) {
    if (val !== null && val !== undefined) {
      params.set(key, String(val))
    }
  }
  return params.toString()
})

const scopeBullets = computed(() =>
  scope.value.includes("mcp:full")
    ? [
        "Read your tickets, reports, screenshots, console + network logs, and replay transcripts",
        "Change ticket status, priority, severity, assignee, and tags",
        "Post comments on your tickets",
        "Link or unlink GitHub issues from your tickets",
      ]
    : scope.value
        .split(" ")
        .filter(Boolean)
        .map((s) => s),
)

const deciding = ref(false)
const errorMessage = ref<string | null>(null)

async function decide(allow: boolean): Promise<void> {
  deciding.value = true
  errorMessage.value = null
  try {
    const res = await $fetch<{ redirectUri: string }>("/api/oauth/consent", {
      method: "POST",
      body: { oauthQuery: oauthQuery.value, allow },
    })
    window.location.assign(res.redirectUri)
  } catch (err: unknown) {
    const msg = (err as { statusMessage?: string }).statusMessage ?? "Something went wrong"
    errorMessage.value = msg
    deciding.value = false
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center px-4">
    <UCard class="w-full max-w-md">
      <template #header>
        <h1 class="text-lg font-semibold text-default">Allow {{ clientName }}?</h1>
      </template>

      <div class="space-y-4">
        <p class="text-sm text-muted">
          {{ clientName }} is requesting access to your Repro account. This will let it:
        </p>
        <ul class="text-sm space-y-1 list-disc pl-5 text-default">
          <li v-for="bullet in scopeBullets" :key="bullet">{{ bullet }}</li>
        </ul>

        <UAlert
          v-if="errorMessage"
          color="error"
          variant="soft"
          :description="errorMessage"
          icon="i-heroicons-exclamation-triangle"
        />
      </div>

      <template #footer>
        <div class="flex flex-col gap-3">
          <div class="flex gap-3">
            <UButton
              label="Allow"
              color="primary"
              class="flex-1"
              :loading="deciding"
              @click="decide(true)"
            />
            <UButton
              label="Deny"
              color="neutral"
              variant="soft"
              class="flex-1"
              :disabled="deciding"
              @click="decide(false)"
            />
          </div>
          <p class="text-xs text-muted text-center">
            You can revoke this anytime in Settings &rarr; Connected apps.
          </p>
        </div>
      </template>
    </UCard>
  </div>
</template>
