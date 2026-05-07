<!--
  Global command palette. Opens on ⌘K / Ctrl+K from anywhere, and also when
  the top-bar project-switcher button or the sidebar's "All projects" CTA
  chooses to dispatch `openPalette()`. Groups:
    1. Actions — create a project, toggle theme
    2. Go to    — navigation into project-scoped pages (visible when a
                  project is in scope) + install-level admin pages
    3. Projects — jump straight to any project the user has access to

  The palette lives in default.vue so it's mounted once and tracks route
  changes for the current-project group.
-->
<script setup lang="ts">
import { computed } from "vue"
import type { ProjectDTO } from "@reprojs/shared"
import { _useCommandPaletteHost } from "~/composables/use-command-palette"

const { open } = _useCommandPaletteHost()
const route = useRoute()
const router = useRouter()
const colorMode = useColorMode()
const { isAdmin } = useSession()

// Piggybacks on the same `/api/projects` request as the sidebar + switcher —
// Nuxt's useFetch dedupes by URL, so no extra round-trip.
const { data: projectsData } = await useApi<ProjectDTO[]>("/api/projects", {
  default: () => [],
})

const routeProjectId = computed(() => {
  const m = /^\/projects\/([^/]+)/.exec(route.path)
  return m ? m[1] : null
})
const lastProjectId = useCookie<string | null>("last-project-id")
const projectIds = computed(() => new Set((projectsData.value ?? []).map((p) => p.id)))

// Same scope resolution as the sidebar: current route > last valid cookie.
const scopedProjectId = computed(() => {
  const id = routeProjectId.value
  if (id) return id
  const cookieId = lastProjectId.value
  if (cookieId && projectIds.value.has(cookieId)) return cookieId
  return null
})

function go(path: string) {
  open.value = false
  router.push(path)
}

// ⌘K on mac, Ctrl+K on others — mirrors the pattern every Linear / Raycast /
// Sentry user already expects. Bound at document level so it works on every
// route. Skipped when the user is typing in an input / textarea so the
// shortcut doesn't clobber the letter "k".
function onKey(e: KeyboardEvent) {
  if (e.key.toLowerCase() !== "k") return
  if (!(e.metaKey || e.ctrlKey)) return
  const t = e.target as HTMLElement | null
  const tag = t?.tagName
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return
  if (t?.isContentEditable) return
  e.preventDefault()
  open.value = !open.value
}
onMounted(() => document.addEventListener("keydown", onKey))
onBeforeUnmount(() => document.removeEventListener("keydown", onKey))

interface CommandItem {
  label: string
  icon?: string
  suffix?: string
  onSelect: () => void
}
interface CommandGroup {
  id: string
  label: string
  items: CommandItem[]
}

const actionGroup = computed<CommandGroup>(() => ({
  id: "actions",
  label: "Actions",
  items: [
    {
      label: "Create new project",
      icon: "i-heroicons-plus",
      onSelect: () => go("/"),
    },
    {
      label: colorMode.value === "dark" ? "Switch to light mode" : "Switch to dark mode",
      icon: colorMode.value === "dark" ? "i-heroicons-sun" : "i-heroicons-moon",
      onSelect: () => {
        colorMode.preference = colorMode.value === "dark" ? "light" : "dark"
        open.value = false
      },
    },
  ],
}))

const navGroup = computed<CommandGroup>(() => {
  const items: CommandItem[] = [
    {
      label: "All projects",
      icon: "i-heroicons-squares-2x2",
      onSelect: () => go("/"),
    },
  ]

  if (scopedProjectId.value) {
    const base = `/projects/${scopedProjectId.value}`
    items.push(
      { label: "Project overview", icon: "i-heroicons-home", onSelect: () => go(base) },
      {
        label: "Reports",
        icon: "i-heroicons-inbox-stack",
        onSelect: () => go(`${base}/reports`),
      },
      {
        label: "Members",
        icon: "i-heroicons-user-group",
        onSelect: () => go(`${base}/members`),
      },
      {
        label: "Integrations",
        icon: "i-heroicons-squares-plus",
        onSelect: () => go(`${base}/integrations`),
      },
      {
        label: "Project settings",
        icon: "i-heroicons-cog-6-tooth",
        onSelect: () => go(`${base}/settings`),
      },
    )
  }

  items.push(
    {
      label: "Account",
      icon: "i-heroicons-user",
      onSelect: () => go("/settings/account"),
    },
    {
      label: "AI assistants (MCP)",
      icon: "i-heroicons-cpu-chip",
      onSelect: () => go("/settings/mcp"),
    },
  )

  if (isAdmin.value) {
    items.push(
      { label: "Users", icon: "i-heroicons-users", onSelect: () => go("/settings/users") },
      {
        label: "Access",
        icon: "i-heroicons-shield-check",
        onSelect: () => go("/settings/access"),
      },
      {
        label: "Install",
        icon: "i-heroicons-code-bracket",
        onSelect: () => go("/settings/install"),
      },
    )
  }

  return { id: "nav", label: "Go to", items }
})

const projectsGroup = computed<CommandGroup>(() => ({
  id: "projects",
  label: "Projects",
  items: (projectsData.value ?? []).map((p) => ({
    label: p.name,
    icon: "i-heroicons-folder",
    suffix: p.id === scopedProjectId.value ? "current" : undefined,
    onSelect: () => go(`/projects/${p.id}`),
  })),
}))

const groups = computed(() => {
  const g: CommandGroup[] = [actionGroup.value, navGroup.value]
  if (projectsGroup.value.items.length > 0) g.push(projectsGroup.value)
  return g
})
</script>

<template>
  <UModal v-model:open="open" :ui="{ content: 'max-w-xl' }">
    <template #content>
      <UCommandPalette :groups="groups" placeholder="Type a command or search…" />
    </template>
  </UModal>
</template>
