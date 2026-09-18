<!--
  Primary navigation sidebar. Three sections from top to bottom:
    1. Header: product mark + wordmark, collapse toggle
    2. Workspace: "All projects" + (when a project is in scope) project-
       scoped links grouped under the project name eyebrow
    3. Admin: install-wide admin links (only rendered for admins)

  Rows are hand-rolled <NuxtLink>/<button> pairs rather than UButton so
  the typography, active-state indicator, and hover rhythm are under our
  control. Earlier UButton `size="sm"` rows felt cramped against the
  larger page headers we introduced; the new rows use `text-sm` with
  more vertical padding and a clearer teal active state.
-->
<script setup lang="ts">
import { computed, watch } from "vue"
import { useRoute } from "vue-router"

const route = useRoute()
const { isAdmin } = useSession()
const collapsed = useCookie<boolean>("sidebar-collapsed", {
  default: () => false,
})

// Remember the most-recently-visited project across route changes so the
// project nav stays visible even on admin-scope pages (/settings/users,
// /settings/install) and on the projects index. Without this, navigating
// from a project into admin makes the project nav disappear, which feels
// like the sidebar is "losing" context.
const lastProjectId = useCookie<string | null>("last-project-id", {
  default: () => null,
})

// Shared projects-list cache (same key as the switcher, palette and
// projects page), so it's one request and stays current after edits.
const { data: projectsData } = await useProjectsList()

// Pending invitations count for the badge. Kept deliberately cheap — the
// endpoint returns a small list and we only display the count in the
// sidebar; the full list lives on /invitations.
const { data: pendingInvitations } = await useApi<Array<{ token: string }>>("/api/invitations", {
  default: () => [],
})
const pendingInviteCount = computed(() => pendingInvitations.value?.length ?? 0)
const projectIds = computed(() => new Set((projectsData.value ?? []).map((p) => p.id)))
const hasAnyProject = computed(() => (projectsData.value?.length ?? 0) > 0)

const routeProjectId = computed(() => {
  const m = /^\/projects\/([^/]+)/.exec(route.path)
  return m ? m[1] : null
})

// Update the cookie whenever we enter a valid project route.
watch(
  routeProjectId,
  (id) => {
    if (id) lastProjectId.value = id
  },
  { immediate: true },
)

// Clear the cookie when it points at a project the user can no longer see
// (deleted, access revoked, or a stale UUID from an old session). Without
// this, project-scoped nav items render links that bounce straight back to
// `/?error=project-not-found` — the sidebar looks alive but is dead.
watch(
  [lastProjectId, projectIds],
  ([id, ids]) => {
    if (id && ids.size > 0 && !ids.has(id)) {
      lastProjectId.value = null
    }
  },
  { immediate: true },
)

// Effective project scope: current route > last-visited cookie (if valid).
const projectId = computed(() => {
  const routeId = routeProjectId.value
  if (routeId) return routeId
  const cookieId = lastProjectId.value
  if (cookieId && projectIds.value.has(cookieId)) return cookieId
  return null
})

const currentProjectName = computed(() => {
  const id = projectId.value
  if (!id) return null
  return projectsData.value?.find((p) => p.id === id)?.name ?? null
})

interface NavItem {
  label: string
  icon: string
  to: string
  // When true, `isActive` only matches the exact path — no prefix match.
  // Needed for "Overview" since its `to` is the project root, and a
  // naive prefix match would mark it active on every sub-route.
  exact?: boolean
}

const projectItems = computed<NavItem[]>(() => {
  if (!projectId.value) return []
  const base = `/projects/${projectId.value}`
  return [
    { label: "Overview", icon: "i-heroicons-home", to: base, exact: true },
    { label: "Reports", icon: "i-heroicons-inbox-stack", to: `${base}/reports` },
    { label: "Members", icon: "i-heroicons-user-group", to: `${base}/members` },
    { label: "Integrations", icon: "i-heroicons-squares-plus", to: `${base}/integrations` },
    { label: "Settings", icon: "i-heroicons-cog-6-tooth", to: `${base}/settings` },
  ]
})

const adminItems = computed<NavItem[]>(() => {
  if (!isAdmin.value) return []
  return [
    { label: "Overview", icon: "i-heroicons-home", to: "/admin", exact: true },
    { label: "Users", icon: "i-heroicons-users", to: "/settings/users" },
    { label: "Access", icon: "i-heroicons-shield-check", to: "/settings/access" },
    { label: "Install", icon: "i-heroicons-code-bracket", to: "/settings/install" },
    { label: "GitHub", icon: "i-mdi-github", to: "/settings/github" },
  ]
})

const width = computed(() => (collapsed.value ? "w-16" : "w-64"))

function toggle() {
  collapsed.value = !collapsed.value
}

function isActive(item: NavItem): boolean {
  if (item.exact) return route.path === item.to
  return route.path === item.to || route.path.startsWith(item.to + "/")
}
</script>

<template>
  <aside
    :class="[
      width,
      'flex-shrink-0 border-r border-default bg-default flex flex-col transition-[width] duration-150',
    ]"
  >
    <!-- Header: brand mark + wordmark + collapse toggle -->
    <div
      :class="[
        'h-14 flex items-center border-b border-default',
        collapsed ? 'justify-center px-0' : 'justify-between px-3',
      ]"
    >
      <NuxtLink
        v-if="!collapsed"
        to="/"
        class="flex items-center gap-2.5 text-base font-semibold tracking-tight text-default hover:text-primary transition-colors"
        aria-label="Repro home"
      >
        <img src="/icon-light.svg" alt="" class="size-6 rounded-[5px] dark:hidden" />
        <img src="/icon-dark.svg" alt="" class="size-6 rounded-[5px] hidden dark:block" />
        <span>Repro</span>
      </NuxtLink>
      <button
        type="button"
        class="inline-flex items-center justify-center size-8 rounded-lg text-muted hover:text-default hover:bg-elevated/60 transition-colors"
        :aria-label="collapsed ? 'Expand sidebar' : 'Collapse sidebar'"
        @click="toggle"
      >
        <UIcon
          :name="collapsed ? 'i-heroicons-bars-3' : 'i-heroicons-chevron-left'"
          class="size-4"
        />
      </button>
    </div>

    <!-- Nav. Rows are standalone NuxtLinks so we can control their type
         and active treatment exactly: icon at size-4, label at text-sm
         medium weight, 2.5 vertical padding, 3px rounded. Active rows
         get a teal tint + left bar + teal icon so the eye lands on the
         current location before anywhere else. -->
    <nav class="flex-1 overflow-y-auto py-3">
      <!-- Root: always-visible "All projects" entry -->
      <div :class="['px-2', collapsed ? '' : '']">
        <NuxtLink
          to="/"
          :aria-label="collapsed ? 'All projects' : undefined"
          :class="[
            'flex items-center rounded-lg transition-colors',
            collapsed ? 'justify-center size-10' : 'gap-3 px-3 py-2.5',
            route.path === '/'
              ? 'bg-elevated text-default font-semibold'
              : 'text-muted hover:text-default hover:bg-elevated/60 font-medium',
          ]"
        >
          <UIcon name="i-heroicons-squares-2x2" class="size-4 shrink-0" />
          <span v-if="!collapsed" class="text-sm truncate">All projects</span>
        </NuxtLink>
      </div>

      <!-- Invitations: only rendered when the user has pending invites.
           Dropped from the nav the moment the count hits zero so the
           sidebar doesn't carry a permanent slot for something most
           users won't see. -->
      <div v-if="pendingInviteCount > 0" class="mt-1 px-2">
        <NuxtLink
          to="/invitations"
          :aria-label="
            collapsed
              ? `${pendingInviteCount} pending invitation${pendingInviteCount === 1 ? '' : 's'}`
              : undefined
          "
          :class="[
            'flex items-center rounded-lg transition-colors',
            collapsed ? 'justify-center size-10' : 'gap-3 px-3 py-2.5',
            route.path === '/invitations'
              ? 'bg-elevated text-default font-semibold'
              : 'text-muted hover:text-default hover:bg-elevated/60 font-medium',
          ]"
        >
          <UIcon name="i-heroicons-envelope" class="size-4 shrink-0" />
          <span v-if="!collapsed" class="text-sm truncate flex-1">Invitations</span>
          <span
            v-if="!collapsed"
            class="text-sm font-semibold px-1.5 py-0.5 rounded bg-primary-500 text-white"
          >
            {{ pendingInviteCount }}
          </span>
          <span
            v-else
            class="absolute ml-5 mt-[-18px] text-sm font-semibold px-1 py-0 rounded-full bg-primary-500 text-white"
          >
            {{ pendingInviteCount }}
          </span>
        </NuxtLink>
      </div>

      <!-- Project scope: eyebrow with current project name + nav items -->
      <div v-if="projectItems.length > 0" class="mt-6 px-2">
        <div
          v-if="!collapsed && currentProjectName"
          :title="currentProjectName"
          class="mb-2 px-3 text-sm font-semibold uppercase tracking-[0.14em] text-muted truncate"
        >
          {{ currentProjectName }}
        </div>
        <div v-else-if="collapsed" class="mx-2 my-3 border-t border-default" />
        <div class="space-y-0.5">
          <NuxtLink
            v-for="item in projectItems"
            :key="item.to"
            :to="item.to"
            :aria-label="collapsed ? item.label : undefined"
            :class="[
              'flex items-center rounded-lg transition-colors',
              collapsed ? 'justify-center size-10' : 'gap-3 px-3 py-2.5',
              isActive(item)
                ? 'bg-elevated text-default font-semibold'
                : 'text-muted hover:text-default hover:bg-elevated/60 font-medium',
            ]"
          >
            <UIcon :name="item.icon" class="size-4 shrink-0" />
            <span v-if="!collapsed" class="text-sm truncate">{{ item.label }}</span>
          </NuxtLink>
        </div>
      </div>

      <!-- Empty workspace hint -->
      <div v-else-if="!collapsed && !hasAnyProject" class="mt-3 px-5">
        <p class="text-sm text-muted leading-relaxed">
          Projects group incoming reports. Create one to get started.
        </p>
      </div>

      <!-- Admin section -->
      <div v-if="adminItems.length > 0" class="mt-6 px-2">
        <div
          v-if="!collapsed"
          class="mb-2 px-3 text-sm font-semibold uppercase tracking-[0.14em] text-muted"
        >
          Admin
        </div>
        <div v-else class="mx-2 my-3 border-t border-default" />
        <div class="space-y-0.5">
          <NuxtLink
            v-for="item in adminItems"
            :key="item.to"
            :to="item.to"
            :aria-label="collapsed ? item.label : undefined"
            :class="[
              'flex items-center rounded-lg transition-colors',
              collapsed ? 'justify-center size-10' : 'gap-3 px-3 py-2.5',
              isActive(item)
                ? 'bg-elevated text-default font-semibold'
                : 'text-muted hover:text-default hover:bg-elevated/60 font-medium',
            ]"
          >
            <UIcon :name="item.icon" class="size-4 shrink-0" />
            <span v-if="!collapsed" class="text-sm truncate">{{ item.label }}</span>
          </NuxtLink>
        </div>
      </div>
    </nav>
  </aside>
</template>
