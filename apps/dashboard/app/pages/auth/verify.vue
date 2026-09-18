<script setup lang="ts">
import { magicLinkVerifyPath, SIGN_IN_PATH } from "~~/shared/auth-redirect"

// The emailed magic link lands here. This page must not spend the token on
// load: mail gateways (Microsoft 365 Safe Links, Proofpoint, antivirus
// scanners) GET every link in a message before the person opens it, and the
// link is single-use. Only the button below sends the verify request.
definePageMeta({ layout: "auth" })
useHead({
  title: "Sign in",
  meta: [{ name: "robots", content: "noindex" }],
})

const route = useRoute()

const verifyPath = computed(() =>
  magicLinkVerifyPath({ token: route.query.token, callbackURL: route.query.callbackURL }),
)

const signingIn = ref(false)

function signIn() {
  if (!verifyPath.value) return
  signingIn.value = true
  // A full navigation, not a fetch: the verify endpoint sets the session
  // cookie and then redirects to the destination, or to the sign-in page
  // with ?error= when the link is expired or already used.
  window.location.assign(verifyPath.value)
}
</script>

<template>
  <div class="space-y-8">
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
      <div v-if="verifyPath" class="space-y-6">
        <div class="text-center">
          <h1 class="text-2xl font-semibold text-default tracking-tight">Finish signing in</h1>
          <p class="text-sm text-muted mt-1.5">
            Press the button to sign in to Repro in this browser.
          </p>
        </div>
        <UButton
          label="Sign in"
          color="primary"
          size="md"
          icon="i-heroicons-arrow-right-end-on-rectangle"
          :loading="signingIn"
          block
          @click="signIn"
        />
        <p class="text-center text-xs text-muted">
          The link works once and expires 5 minutes after it was sent.
        </p>
      </div>

      <div v-else class="space-y-6">
        <div class="text-center">
          <h1 class="text-2xl font-semibold text-default tracking-tight">
            This sign-in link is incomplete
          </h1>
          <p class="text-sm text-muted mt-1.5">
            Copy the whole link from the email, or request a fresh one.
          </p>
        </div>
        <UButton
          :to="SIGN_IN_PATH"
          label="Back to sign in"
          color="neutral"
          variant="outline"
          size="md"
          block
        />
      </div>
    </UCard>
  </div>
</template>
