<script setup lang="ts">
import PageHeader from "~/components/common/page-header.vue"
import CodeSnippet from "~/components/common/code-snippet.vue"
import InstallSnippet from "~/components/common/install-snippet.vue"
import { buildInitSnippet } from "~/utils/install-snippet"

definePageMeta({ middleware: "admin-only" })
useHead({ title: "Install SDK" })

const route = useRoute()

// SDK embed origin = the URL the operator is currently viewing. `useRequestURL()`
// resolves at request time (SSR → Host header via reverse proxy; client →
// `window.location.origin`) so the copy-paste snippet always matches the
// dashboard's real public hostname, without depending on a build-time env var.
const SDK_ORIGIN = useRequestURL().origin

// Project picker. Preselect, in order: `?project=` from the link that brought
// the admin here, the last project they visited (same cookie the sidebar
// uses), then the first project they can see.
const { data: projects } = await useProjectsList()
const lastProjectId = useCookie<string | null>("last-project-id", { default: () => null })
const projectOptions = computed(() =>
  (projects.value ?? []).map((p) => ({ label: p.name, value: p.id })),
)
function pickInitialProject(): string | undefined {
  const list = projects.value ?? []
  const fromQuery = typeof route.query.project === "string" ? route.query.project : undefined
  for (const candidate of [fromQuery, lastProjectId.value]) {
    if (candidate && list.some((p) => p.id === candidate)) return candidate
  }
  return list[0]?.id
}
const selectedProjectId = ref<string | undefined>(pickInitialProject())
const selectedProject = computed(
  () => (projects.value ?? []).find((p) => p.id === selectedProjectId.value) ?? null,
)
const projectKey = computed(() => selectedProject.value?.publicKey ?? null)

const initSnippet = computed(() =>
  buildInitSnippet({ origin: SDK_ORIGIN, projectKey: projectKey.value }),
)

const identifySnippet = `feedback.identify({
  userId: "user_123",
  email: "user@example.com",
  name: "Alex Example",
})`

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
const activePmCommand = computed(() => pmCommands[activePm.value])

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

    <UCard>
      <template #header>
        <h2 class="text-base font-semibold text-default">Project</h2>
      </template>
      <div v-if="projectOptions.length === 0" class="text-sm text-muted">
        You don't have any projects yet.
        <NuxtLink to="/" class="text-primary hover:underline">Create one</NuxtLink>
        and come back for a ready-to-paste snippet.
      </div>
      <div v-else class="space-y-3">
        <p class="text-sm text-muted">
          The snippets below are filled in with this project's public key, so they work as pasted.
        </p>
        <div class="flex flex-wrap items-center gap-3">
          <USelectMenu
            v-model="selectedProjectId"
            :items="projectOptions"
            value-key="value"
            placeholder="Pick a project"
            class="w-64"
          />
          <NuxtLink
            v-if="selectedProjectId"
            :to="`/projects/${selectedProjectId}/settings?tab=security`"
            class="text-sm text-muted hover:text-primary transition-colors"
          >
            Manage this key →
          </NuxtLink>
        </div>
      </div>
    </UCard>

    <UAccordion :items="accordionItems" multiple>
      <template #script-body>
        <InstallSnippet :project-key="projectKey" />
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
          <CodeSnippet :code="activePmCommand" lang="bash" copy-label="Copy install command" />
        </div>
      </template>
      <template #init-body>
        <div class="space-y-2">
          <p class="text-sm text-muted">
            Call <code class="font-mono px-1 rounded bg-muted">init()</code> once on app boot:
          </p>
          <CodeSnippet :code="initSnippet" lang="typescript" copy-label="Copy init snippet" />
        </div>
      </template>
      <template #identify-body>
        <div class="space-y-2">
          <p class="text-sm text-muted">
            Call <code class="font-mono px-1 rounded bg-muted">identify()</code> after the user
            signs in so reports include their profile.
          </p>
          <CodeSnippet
            :code="identifySnippet"
            lang="typescript"
            copy-label="Copy identify snippet"
          />
        </div>
      </template>
    </UAccordion>
  </div>
</template>
