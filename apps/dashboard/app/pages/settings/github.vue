<script setup lang="ts">
import PageHeader from "~/components/common/page-header.vue"
import { describeApiError } from "~/utils/api-error"
import type {
  AuthProvidersDTO,
  GithubAppStatusDTO,
  GithubOAuthCredentialsDTO,
} from "@reprojs/shared"
definePageMeta({ middleware: "admin-only" })
useHead({ title: "GitHub App" })

const route = useRoute()
const toast = useToast()
const { confirm } = useConfirm()
// Resolved at request time so the webhook URL shown in the instructions —
// and the manifest-start redirect — always match the hostname operators are
// viewing, even on pre-built Docker images where BETTER_AUTH_URL wasn't set
// at build time.
const dashboardUrl = useRequestURL().origin

const { data: status, refresh } = await useApi<GithubAppStatusDTO>(
  "/api/integrations/github/app-status",
)
// The status narrowed to its configured shape, so slug/clientId are typed.
const configuredApp = computed(() => (status.value?.configured ? status.value : null))

const { data: providers, refresh: refreshProviders } =
  await useApi<AuthProvidersDTO>("/api/auth/providers")

const revealed = ref<GithubOAuthCredentialsDTO | null>(null)
const revealing = ref(false)
const revealError = ref<string | null>(null)
const remainingSec = ref(0)
const copyFailed = ref(false)
let hideTimer: ReturnType<typeof setTimeout> | null = null
let countdownTimer: ReturnType<typeof setInterval> | null = null

// clientId comes from the non-audited /api/integrations/github/app-status
// endpoint, which is already fetched on page load. The reveal endpoint also
// returns clientId (for completeness on the one-click reveal flow), but we
// prefer the already-fetched value so re-rendering never hits the audited
// endpoint without an explicit admin click.
const clientIdDisplay = computed(
  () => revealed.value?.clientId ?? configuredApp.value?.clientId ?? "",
)

function clearRevealed() {
  revealed.value = null
  remainingSec.value = 0
  copyFailed.value = false
  if (hideTimer) {
    clearTimeout(hideTimer)
    hideTimer = null
  }
  if (countdownTimer) {
    clearInterval(countdownTimer)
    countdownTimer = null
  }
}

async function revealSecret() {
  revealing.value = true
  revealError.value = null
  copyFailed.value = false
  try {
    const creds = await $fetch<GithubOAuthCredentialsDTO>(
      "/api/integrations/github/oauth-credentials",
    )
    revealed.value = creds
    remainingSec.value = 30
    countdownTimer = setInterval(() => {
      remainingSec.value = Math.max(0, remainingSec.value - 1)
    }, 1000)
    hideTimer = setTimeout(clearRevealed, 30_000)
  } catch (e: unknown) {
    revealError.value = describeApiError(e, "Failed to reveal — try again")
  } finally {
    revealing.value = false
  }
}

async function copyToClipboard(value: string) {
  try {
    await navigator.clipboard.writeText(value)
    copyFailed.value = false
  } catch {
    copyFailed.value = true
  }
}

onBeforeUnmount(clearRevealed)

const justCreated = computed(() => route.query.created === "1")

const orgInput = ref("")
const creating = ref(false)

function startManifestFlow() {
  creating.value = true
  const org = orgInput.value.trim()
  const url = org
    ? `${dashboardUrl}/api/integrations/github/manifest-start?org=${encodeURIComponent(org)}`
    : `${dashboardUrl}/api/integrations/github/manifest-start`
  window.location.href = url
}

const githubAppSettingsUrl = computed(() => {
  const slug = configuredApp.value?.slug
  if (!slug) return null
  return `https://github.com/settings/apps/${slug}`
})

const githubAppPublicUrl = computed(() => {
  const slug = configuredApp.value?.slug
  if (!slug) return null
  return `https://github.com/apps/${slug}`
})

const githubAppAdvancedUrl = computed(() => {
  const slug = configuredApp.value?.slug
  if (!slug) return null
  return `https://github.com/settings/apps/${slug}/advanced`
})

const disconnecting = ref(false)

async function disconnect() {
  const slug = configuredApp.value?.slug ?? "the GitHub App"
  const ok = await confirm({
    title: "Disconnect GitHub App?",
    description: `This removes ${slug}'s credentials from this dashboard and unlinks every project installation. Report history is preserved. The app itself still exists on GitHub — delete it from your GitHub App's Advanced settings if you also want it gone there.`,
    confirmLabel: "Disconnect",
    confirmColor: "error",
    icon: "i-heroicons-exclamation-triangle",
  })
  if (!ok) return
  disconnecting.value = true
  try {
    const res = await $fetch<{
      ok: true
      purgedIntegrations: number
      purgedSyncJobs: number
    }>("/api/integrations/github/app", { method: "DELETE", credentials: "include" })
    clearRevealed()
    await Promise.all([refresh(), refreshProviders()])
    toast.add({
      title: "GitHub App disconnected",
      description:
        res.purgedIntegrations === 0
          ? "Credentials cleared."
          : `Credentials cleared; ${res.purgedIntegrations} project integration(s) and ${res.purgedSyncJobs} pending sync job(s) removed.`,
      color: "success",
      icon: "i-heroicons-check-circle",
    })
  } catch (e: unknown) {
    toast.add({
      title: "Could not disconnect",
      description: describeApiError(e),
      color: "error",
      icon: "i-heroicons-exclamation-triangle",
    })
  } finally {
    disconnecting.value = false
  }
}
</script>

<template>
  <div class="space-y-6 max-w-3xl">
    <PageHeader
      eyebrow="Admin"
      title="GitHub integration"
      description="Connect this instance to GitHub so ticket triage can mirror to issues. A GitHub App is installed on your organization or personal account — each self-hosted Repro instance creates its own app with its own credentials."
    />

    <UAlert
      v-if="justCreated"
      color="success"
      icon="i-heroicons-check-circle"
      title="GitHub App created"
      description="Credentials have been stored securely. One manual step remains — enable webhook delivery in your GitHub App settings (see the card below)."
    />

    <UCard v-if="!status?.configured">
      <template #header>
        <h2 class="text-base font-semibold text-default">Create GitHub App</h2>
      </template>
      <div class="space-y-4">
        <p class="text-sm text-muted">
          GitHub will create a new app on your account with the callback and setup URLs
          pre-configured for this instance. The app's private key, webhook secret, and client
          credentials are returned to this dashboard and stored encrypted at rest.
        </p>
        <div>
          <label for="org" class="block text-sm font-medium text-default mb-1">
            Organization (optional)
          </label>
          <UInput id="org" v-model="orgInput" placeholder="my-org" class="max-w-sm" />
          <p class="text-sm text-muted mt-1">
            Leave empty to create the app on your personal GitHub account.
          </p>
        </div>
        <p class="text-sm text-muted">
          <strong class="text-default">Note:</strong> The app is created with webhooks
          <strong>disabled</strong>. You'll need to enable them manually after setup to receive
          two-way sync events. See the instructions shown after the app is created.
        </p>
        <UButton :loading="creating" color="primary" icon="i-mdi-github" @click="startManifestFlow">
          Create GitHub App
        </UButton>
      </div>
    </UCard>

    <UCard v-else>
      <template #header>
        <div class="flex items-center justify-between">
          <h2 class="text-base font-semibold text-default">GitHub App configured</h2>
          <UBadge :color="status.source === 'env' ? 'neutral' : 'success'" variant="subtle">
            {{ status.source === "env" ? "Env vars" : "In-app setup" }}
          </UBadge>
        </div>
      </template>
      <dl class="space-y-3 text-sm">
        <div class="flex gap-4">
          <dt class="text-muted w-28">App ID</dt>
          <dd class="font-mono text-default">{{ status.appId }}</dd>
        </div>
        <div class="flex gap-4">
          <dt class="text-muted w-28">Slug</dt>
          <dd class="font-mono text-default">{{ status.slug }}</dd>
        </div>
        <div v-if="githubAppPublicUrl" class="flex gap-4">
          <dt class="text-muted w-28">Public page</dt>
          <dd>
            <ULink :to="githubAppPublicUrl" target="_blank" class="text-primary">
              {{ githubAppPublicUrl }}
            </ULink>
          </dd>
        </div>
      </dl>
      <template v-if="status.source === 'env'" #footer>
        <p class="text-sm text-muted">
          This instance reads GitHub App credentials from environment variables. To migrate to the
          in-app setup flow, unset the <code>GITHUB_APP_*</code> vars and reload this page.
        </p>
      </template>
      <template v-else #footer>
        <div class="flex items-center justify-between gap-2">
          <UButton variant="subtle" color="neutral" @click="() => refresh()">Refresh</UButton>
          <div class="flex items-center gap-3">
            <ULink
              v-if="githubAppAdvancedUrl"
              :to="githubAppAdvancedUrl"
              target="_blank"
              class="text-sm text-muted hover:text-default"
            >
              Delete on GitHub &rarr;
            </ULink>
            <UButton
              variant="subtle"
              color="error"
              icon="i-heroicons-trash"
              :loading="disconnecting"
              @click="disconnect"
            >
              Disconnect
            </UButton>
          </div>
        </div>
      </template>
    </UCard>

    <UCard v-if="status?.configured && status.source === 'db'">
      <template #header>
        <h2 class="text-base font-semibold text-default">Enable webhooks (manual step)</h2>
      </template>
      <div class="space-y-3 text-sm">
        <p class="text-muted">
          Webhooks power two-way sync (GitHub issue closed → Repro ticket closed). GitHub requires
          the webhook URL to be publicly reachable before an app is created, so Repro creates the
          app with webhooks <strong>disabled</strong>. Enable them yourself in one step:
        </p>
        <ol class="list-decimal pl-5 space-y-1 text-muted">
          <li>
            Open
            <ULink :to="githubAppSettingsUrl ?? '#'" target="_blank" class="text-primary">
              your GitHub App settings page
            </ULink>
            (Owner &rarr; Edit).
          </li>
          <li>Scroll to <strong>Webhook</strong>.</li>
          <li>
            Set the URL to
            <code class="font-mono px-1 rounded bg-muted">
              {{ dashboardUrl }}/api/integrations/github/webhook
            </code>
          </li>
          <li>Check <strong>Active</strong> and click <strong>Save changes</strong>.</li>
        </ol>
        <p class="text-sm text-muted">
          The webhook secret was already generated and stored during setup — no need to change it.
        </p>
      </div>
    </UCard>

    <UCard v-if="status?.configured && status.source === 'db'">
      <template #header>
        <div class="flex items-center justify-between">
          <h2 class="text-base font-semibold text-default">GitHub sign-in credentials</h2>
          <UBadge :color="providers?.github ? 'success' : 'warning'" variant="subtle">
            {{ providers?.github ? "Sign-in enabled" : "Sign-in not configured" }}
          </UBadge>
        </div>
      </template>
      <div class="space-y-4 text-sm">
        <p class="text-muted">
          Your GitHub App can also power "Sign in with GitHub" in the dashboard. Copy the values
          below into your <code class="font-mono px-1 rounded bg-muted">.env</code> file and restart
          the dashboard.
        </p>

        <div class="space-y-3">
          <div>
            <label class="block text-sm font-medium text-muted mb-1">Client ID</label>
            <div class="flex gap-2">
              <UInput :model-value="clientIdDisplay" readonly class="font-mono flex-1" />
              <UButton
                variant="subtle"
                color="neutral"
                icon="i-heroicons-clipboard"
                aria-label="Copy client ID"
                :disabled="!clientIdDisplay"
                @click="() => clientIdDisplay && copyToClipboard(clientIdDisplay)"
              >
                Copy
              </UButton>
            </div>
          </div>

          <div>
            <label class="block text-sm font-medium text-muted mb-1">Client secret</label>
            <div class="flex gap-2">
              <UInput
                :model-value="revealed ? revealed.clientSecret : '••••••••••••••••'"
                readonly
                :type="revealed ? 'text' : 'password'"
                class="font-mono flex-1"
              />
              <UButton
                v-if="!revealed"
                :loading="revealing"
                variant="subtle"
                color="primary"
                icon="i-heroicons-eye"
                @click="revealSecret"
              >
                Reveal
              </UButton>
              <template v-else>
                <UButton
                  variant="subtle"
                  color="neutral"
                  icon="i-heroicons-clipboard"
                  aria-label="Copy client secret"
                  @click="() => revealed && copyToClipboard(revealed.clientSecret)"
                >
                  Copy
                </UButton>
                <UButton
                  variant="subtle"
                  color="neutral"
                  icon="i-heroicons-eye-slash"
                  :aria-label="`Hide client secret (${remainingSec} seconds remaining)`"
                  @click="clearRevealed"
                >
                  Hide ({{ remainingSec }}s)
                </UButton>
              </template>
            </div>
            <p v-if="copyFailed" class="text-sm text-warning mt-1">
              Copy failed — select and copy the value manually.
            </p>
            <p v-if="revealError" class="text-sm text-error mt-1">
              {{ revealError }}
            </p>
          </div>
        </div>

        <div class="bg-muted/50 rounded p-3 text-sm text-muted space-y-1">
          <p class="font-medium text-default">Add to your .env and restart:</p>
          <pre class="font-mono whitespace-pre-wrap">
GITHUB_CLIENT_ID=&lt;your client id&gt;
GITHUB_CLIENT_SECRET=&lt;your client secret&gt;</pre
          >
        </div>

        <div v-if="!providers?.github" class="flex gap-2">
          <UButton variant="subtle" color="neutral" @click="() => refreshProviders()">
            I've restarted — re-check
          </UButton>
        </div>
      </div>
    </UCard>
  </div>
</template>
