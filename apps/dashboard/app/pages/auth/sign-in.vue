<script setup lang="ts">
import type { AuthProviderStatus } from "~~/server/lib/auth-providers"
import { authErrorMessage, safeNextPath, SIGN_IN_PATH } from "~~/shared/auth-redirect"

definePageMeta({ layout: "auth" })
useHead({ title: "Sign in" })

const { session, signIn } = useSession()
const router = useRouter()
const route = useRoute()
const toast = useToast()

// Which OAuth providers are enabled is read at request time from the server
// rather than a build-time-baked runtime config — that way, setting
// GITHUB_CLIENT_ID / GOOGLE_CLIENT_ID on a pre-built Docker image at
// container start correctly shows the buttons without a rebuild.
const { data: providers } = await useFetch<AuthProviderStatus>("/api/auth/providers", {
  default: () => ({ github: false, google: false }),
})

// If already signed in, bounce to the projects index.
watchEffect(() => {
  if (session.value?.data?.user) {
    router.replace("/")
  }
})

const email = ref("")
const magicLinkSent = ref(false)
const sendingLink = ref(false)

// Surface every rejection the server-side auth pipeline can bounce back
// with: our own workspace gates (domain allowlist / invite-only), better-
// auth's magic-link verify failures, and its OAuth callback failures. All of
// them arrive here as `?error=<code>` — see shared/auth-redirect.ts for the
// full code list and where each one is thrown.
const gateError = computed(() => authErrorMessage(route.query.error))

// Where to land after a successful sign-in. `next` is attacker-influenced
// (it rides in the URL), and better-auth reuses it as the magic-link error
// target too, so it is validated down to a renderable same-origin page path
// before it goes anywhere near `callbackURL`.
const nextPath = computed(() => safeNextPath(route.query.next))

async function sendMagicLink() {
  if (!email.value) return
  sendingLink.value = true
  try {
    // callbackURL is where the browser lands AFTER the token is verified and
    // the session cookie is set. `next` preserves the pre-redirect target.
    //
    // errorCallbackURL must be set explicitly: better-auth's magic-link
    // verify falls back to `callbackURL` for its failure redirects
    // (INVALID_TOKEN / EXPIRED_TOKEN / ATTEMPTS_EXCEEDED), which sends the
    // user to a post-login page they aren't logged in to — the auth guard
    // then bounces them to /auth/sign-in and drops the `?error=`, so the
    // sign-in page reappears with no explanation. Pointing failures straight
    // at the sign-in page keeps the reason visible. server/lib/auth.ts
    // enforces the same two values server-side.
    const { error: err } = await signIn.magicLink({
      email: email.value,
      callbackURL: nextPath.value,
      errorCallbackURL: SIGN_IN_PATH,
    })
    if (err) {
      toast.add({
        title: "Could not send sign-in link",
        description: err.message ?? undefined,
        color: "error",
        icon: "i-heroicons-exclamation-triangle",
      })
      return
    }
    magicLinkSent.value = true
  } finally {
    sendingLink.value = false
  }
}

async function oauth(provider: "github" | "google") {
  try {
    // Without errorCallbackURL a failed OAuth callback renders better-auth's
    // bare built-in error page at /api/auth/error; send it back to the
    // sign-in page so the reason lands next to the retry button.
    await signIn.social({
      provider,
      callbackURL: nextPath.value,
      errorCallbackURL: SIGN_IN_PATH,
    })
  } catch (err) {
    toast.add({
      title: `${provider === "github" ? "GitHub" : "Google"} sign-in failed`,
      description: err instanceof Error ? err.message : undefined,
      color: "error",
      icon: "i-heroicons-exclamation-triangle",
    })
  }
}

const hasOAuth = computed(() => providers.value.github || providers.value.google)
</script>

<template>
  <div class="space-y-8">
    <!-- Product logo + wordmark above the card — same viewfinder used in
         the sidebar + favicon, dropped onto a soft glow so it reads as
         emblem rather than chrome. -->
    <div class="flex flex-col items-center gap-3">
      <div class="relative">
        <div
          class="pointer-events-none absolute inset-0 -m-2 rounded-3xl bg-primary/20 blur-xl"
          aria-hidden="true"
        />
        <img
          src="/icon-light.svg"
          alt=""
          class="relative size-12 rounded-xl shadow-md dark:hidden"
        />
        <img
          src="/icon-dark.svg"
          alt=""
          class="relative size-12 rounded-xl shadow-md hidden dark:block"
        />
      </div>
      <span class="text-sm font-medium uppercase tracking-[0.18em] text-muted"> Repro </span>
    </div>

    <UCard
      :ui="{
        root: 'rounded-2xl backdrop-blur-sm bg-default/80 border-default/80 shadow-xl',
        body: 'p-8',
      }"
    >
      <div class="space-y-6">
        <div class="text-center">
          <h1 class="text-2xl font-semibold text-default tracking-tight">Welcome back</h1>
          <p class="text-sm text-muted mt-1.5">Sign in to triage your incoming reports.</p>
        </div>

        <div
          v-if="gateError"
          class="rounded-lg border border-error/30 bg-error/5 px-3 py-2.5 text-sm text-error"
        >
          {{ gateError }}
        </div>

        <div
          v-if="magicLinkSent"
          class="rounded-lg border border-success/30 bg-success/5 px-3 py-3 text-sm text-default"
        >
          Check your inbox — we sent a sign-in link to <strong>{{ email }}</strong
          >. It expires in 5 minutes.
        </div>

        <form v-else class="space-y-4" @submit.prevent="sendMagicLink">
          <UFormField label="Work email" required>
            <UInput
              v-model="email"
              type="email"
              placeholder="you@company.com"
              autocomplete="email"
              size="md"
              icon="i-heroicons-envelope"
              class="w-full"
            />
          </UFormField>
          <UButton
            type="submit"
            label="Email me a sign-in link"
            color="primary"
            size="md"
            :loading="sendingLink"
            block
          />
        </form>

        <template v-if="!magicLinkSent && hasOAuth">
          <USeparator label="or" />

          <div class="space-y-2">
            <UButton
              v-if="providers.github"
              label="Continue with GitHub"
              icon="i-simple-icons-github"
              color="neutral"
              variant="outline"
              size="md"
              block
              @click="oauth('github')"
            />
            <UButton
              v-if="providers.google"
              label="Continue with Google"
              icon="i-simple-icons-google"
              color="neutral"
              variant="outline"
              size="md"
              block
              @click="oauth('google')"
            />
          </div>
        </template>
      </div>
    </UCard>

    <p class="text-center text-sm text-muted">
      By continuing you agree to keep your reports to yourself and be nice to your teammates.
    </p>
  </div>
</template>
