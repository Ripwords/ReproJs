<script setup lang="ts">
import PageHeader from "~/components/common/page-header.vue"
import { computed, onMounted, ref } from "vue"

definePageMeta({ middleware: "admin-only" })
useHead({ title: "Install SDK" })

const toast = useToast()

// SDK embed origin = the URL the operator is currently viewing. `useRequestURL()`
// resolves at request time (SSR → Host header via reverse proxy; client →
// `window.location.origin`) so the copy-paste snippet always matches the
// dashboard's real public hostname, without depending on a build-time env var.
const SDK_ORIGIN = useRequestURL().origin
const PROJECT_KEY_EXAMPLE = "rp_pk_xxxxxxxxxxxxxxxxxxxxxxxx"

// Lazy-load shiki once. Cache the highlighter across tab switches so the
// ~1MB WASM payload only loads when the user actually opens this page.
// Shiki defaults to an Oniguruma (C→WASM) regex engine for TextMate grammar
// parsing. That path requires CSP `'wasm-unsafe-eval'` in script-src, which
// broadens our security headers for the whole app. The JS engine is a pure-JS
// regex runtime — same API, no WASM, runs inside the default strict CSP.
// It's a touch slower to parse (~2× on cold start) but imperceptible for the
// handful of small snippets we render on this page.
let highlighterPromise: Promise<import("shiki").Highlighter> | null = null
function getHighlighter() {
  if (!highlighterPromise) {
    highlighterPromise = Promise.all([import("shiki"), import("shiki/engine/javascript")]).then(
      ([shiki, js]) =>
        shiki.createHighlighter({
          themes: ["github-light", "github-dark"],
          langs: ["html", "javascript", "typescript", "bash"],
          engine: js.createJavaScriptRegexEngine(),
        }),
    )
  }
  return highlighterPromise
}

type SnippetLang = "html" | "javascript" | "typescript" | "bash"

interface Snippet {
  code: string
  lang: SnippetLang
  highlightedLight: string
  highlightedDark: string
}

async function highlight(
  code: string,
  lang: SnippetLang,
): Promise<Pick<Snippet, "highlightedLight" | "highlightedDark">> {
  const h = await getHighlighter()
  return {
    highlightedLight: h.codeToHtml(code, { lang, theme: "github-light" }),
    highlightedDark: h.codeToHtml(code, { lang, theme: "github-dark" }),
  }
}

// IMPORTANT: the backslash escapes on the closing script markers inside the
// HTML snippet below are mandatory. Without them the Vue SFC compiler sees
// a real closing tag and terminates this block early. Keep the backslashes
// even though oxlint flags them as "no-useless-escape".
/* oxlint-disable no-useless-escape */
const raw = {
  script: {
    lang: "html" as const,
    // `onload` ties the init call to the bundle's own load completion —
    // without it, an async script + separate inline init race, and the
    // inline often runs first with "Repro is not defined". See
    // docs/guide/sdk.md for the trade-off + a synchronous alternative.
    code: `<script
  src="${SDK_ORIGIN}/sdk/repro.iife.js"
  async
  onload="Repro.init({ projectKey: '${PROJECT_KEY_EXAMPLE}', endpoint: '${SDK_ORIGIN}' })"
><\/script>`,
  },
  init: {
    lang: "typescript" as const,
    code: `import { init } from "@reprojs/core"

init({
  projectKey: "${PROJECT_KEY_EXAMPLE}",
  endpoint: "${SDK_ORIGIN}",
})`,
  },
  identify: {
    lang: "typescript" as const,
    code: `feedback.identify({
  userId: "user_123",
  email: "user@example.com",
  name: "Alex Example",
})`,
  },
} satisfies Record<string, { code: string; lang: SnippetLang }>
/* oxlint-enable no-useless-escape */

type SnippetKey = keyof typeof raw

const snippets = ref<Record<SnippetKey, Snippet>>({
  script: {
    code: raw.script.code,
    lang: raw.script.lang,
    highlightedLight: "",
    highlightedDark: "",
  },
  init: {
    code: raw.init.code,
    lang: raw.init.lang,
    highlightedLight: "",
    highlightedDark: "",
  },
  identify: {
    code: raw.identify.code,
    lang: raw.identify.lang,
    highlightedLight: "",
    highlightedDark: "",
  },
})

// Install commands per package manager. `@reprojs/core` bundles the widget
// UI, recorder, and shared types — consumers install a single package. Deno
// uses `deno add` with an `npm:` specifier.
const pmCommands = {
  npm: "npm install @reprojs/core",
  pnpm: "pnpm add @reprojs/core",
  yarn: "yarn add @reprojs/core",
  bun: "bun add @reprojs/core",
  deno: "deno add npm:@reprojs/core",
} as const

type PackageManager = keyof typeof pmCommands

const packageManagers = [
  { label: "npm", value: "npm" as const },
  { label: "pnpm", value: "pnpm" as const },
  { label: "yarn", value: "yarn" as const },
  { label: "bun", value: "bun" as const },
  { label: "deno", value: "deno" as const },
]

const activePm = useCookie<PackageManager>("install-pm", { default: () => "npm" })

const pmSnippets = ref<Record<PackageManager, Snippet>>({
  npm: { code: pmCommands.npm, lang: "bash", highlightedLight: "", highlightedDark: "" },
  pnpm: { code: pmCommands.pnpm, lang: "bash", highlightedLight: "", highlightedDark: "" },
  yarn: { code: pmCommands.yarn, lang: "bash", highlightedLight: "", highlightedDark: "" },
  bun: { code: pmCommands.bun, lang: "bash", highlightedLight: "", highlightedDark: "" },
  deno: { code: pmCommands.deno, lang: "bash", highlightedLight: "", highlightedDark: "" },
})

const activePmSnippet = computed(() => pmSnippets.value[activePm.value])

onMounted(async () => {
  const keys = Object.keys(raw) as SnippetKey[]
  const results = await Promise.all(keys.map((key) => highlight(raw[key].code, raw[key].lang)))
  for (const [i, key] of keys.entries()) {
    const result = results[i]
    if (!result) continue
    snippets.value[key].highlightedLight = result.highlightedLight
    snippets.value[key].highlightedDark = result.highlightedDark
  }

  // Highlight every package-manager command once so tab-switching is instant.
  const pmKeys = Object.keys(pmCommands) as PackageManager[]
  const pmResults = await Promise.all(pmKeys.map((k) => highlight(pmCommands[k], "bash")))
  for (const [i, key] of pmKeys.entries()) {
    const r = pmResults[i]
    if (!r) continue
    pmSnippets.value[key].highlightedLight = r.highlightedLight
    pmSnippets.value[key].highlightedDark = r.highlightedDark
  }
})

async function copy(code: string) {
  try {
    await navigator.clipboard.writeText(code)
    toast.add({
      title: "Copied to clipboard",
      color: "success",
      icon: "i-heroicons-clipboard-document-check",
    })
  } catch {
    toast.add({ title: "Copy failed", color: "error" })
  }
}

const accordionItems = computed(() => [
  { label: "1. Add the script tag", slot: "script" as const },
  { label: "2. Or install via a package manager", slot: "pm" as const },
  { label: "3. Initialize the SDK", slot: "init" as const },
  { label: "4. Identify signed-in users (optional)", slot: "identify" as const },
])
</script>

<template>
  <div class="space-y-6 max-w-4xl">
    <PageHeader
      eyebrow="Admin"
      title="Install the SDK"
      description="Drop the widget into any web app in under a minute. Works with vanilla JS, React, Vue, Svelte, Nuxt, Next, or any framework."
    />

    <UAccordion :items="accordionItems" multiple>
      <template #script-body>
        <div class="space-y-2">
          <p class="text-sm text-muted">
            Paste this before the closing
            <code class="font-mono px-1 rounded bg-muted">&lt;/body&gt;</code>
            tag. The widget loads asynchronously and won't block your page.
          </p>
          <div class="relative rounded-lg border border-default overflow-hidden">
            <div class="hidden dark:block" v-html="snippets.script.highlightedDark" />
            <div class="block dark:hidden" v-html="snippets.script.highlightedLight" />
            <UButton
              class="absolute top-2 right-2"
              icon="i-heroicons-clipboard"
              size="xs"
              color="neutral"
              variant="subtle"
              aria-label="Copy"
              @click="copy(snippets.script.code)"
            />
          </div>
        </div>
      </template>
      <template #pm-body>
        <div class="space-y-3">
          <p class="text-sm text-muted">Install the packages with your preferred tool:</p>
          <div class="flex flex-wrap gap-1 rounded-lg border border-default bg-muted/30 p-1">
            <button
              v-for="pm in packageManagers"
              :key="pm.value"
              type="button"
              :class="[
                'px-3 py-1 text-sm rounded-md transition-colors',
                activePm === pm.value
                  ? 'bg-default text-default shadow-sm font-medium'
                  : 'text-muted hover:text-default',
              ]"
              @click="activePm = pm.value"
            >
              {{ pm.label }}
            </button>
          </div>
          <div class="relative rounded-lg border border-default overflow-hidden">
            <div class="hidden dark:block" v-html="activePmSnippet.highlightedDark" />
            <div class="block dark:hidden" v-html="activePmSnippet.highlightedLight" />
            <UButton
              class="absolute top-2 right-2"
              icon="i-heroicons-clipboard"
              size="xs"
              color="neutral"
              variant="subtle"
              aria-label="Copy"
              @click="copy(activePmSnippet.code)"
            />
          </div>
        </div>
      </template>
      <template #init-body>
        <div class="space-y-2">
          <p class="text-sm text-muted">
            Call <code class="font-mono px-1 rounded bg-muted">init()</code> once on app boot:
          </p>
          <div class="relative rounded-lg border border-default overflow-hidden">
            <div class="hidden dark:block" v-html="snippets.init.highlightedDark" />
            <div class="block dark:hidden" v-html="snippets.init.highlightedLight" />
            <UButton
              class="absolute top-2 right-2"
              icon="i-heroicons-clipboard"
              size="xs"
              color="neutral"
              variant="subtle"
              aria-label="Copy"
              @click="copy(snippets.init.code)"
            />
          </div>
        </div>
      </template>
      <template #identify-body>
        <div class="space-y-2">
          <p class="text-sm text-muted">
            Call <code class="font-mono px-1 rounded bg-muted">identify()</code> after the user
            signs in so reports include their profile.
          </p>
          <div class="relative rounded-lg border border-default overflow-hidden">
            <div class="hidden dark:block" v-html="snippets.identify.highlightedDark" />
            <div class="block dark:hidden" v-html="snippets.identify.highlightedLight" />
            <UButton
              class="absolute top-2 right-2"
              icon="i-heroicons-clipboard"
              size="xs"
              color="neutral"
              variant="subtle"
              aria-label="Copy"
              @click="copy(snippets.identify.code)"
            />
          </div>
        </div>
      </template>
    </UAccordion>

    <UCard>
      <template #header>
        <h2 class="text-base font-semibold text-default">Your project keys</h2>
      </template>
      <p class="text-sm text-muted">
        Replace
        <code class="font-mono px-1 rounded bg-muted">{{ PROJECT_KEY_EXAMPLE }}</code>
        in the snippets above with a real project's public key. Find it under
        <strong>Project &rarr; Settings &rarr; Security</strong>.
      </p>
    </UCard>
  </div>
</template>

<style>
/* Shiki-emitted <pre> styling — fit into our layout (no horizontal scroll
   jitter, consistent padding, monospace inherits from the page). */
.shiki {
  padding: 0.875rem 1rem;
  font-size: 0.875rem;
  line-height: 1.5;
  overflow-x: auto;
}
.shiki code {
  font-family: inherit;
}
</style>
