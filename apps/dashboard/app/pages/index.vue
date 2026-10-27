<script setup lang="ts">
import PageHeader from "~/components/common/page-header.vue"
import { describeApiError } from "~/utils/api-error"
import type { ProjectDTO, ProjectStatsDTO } from "@reprojs/shared"
import { formatRelative } from "~/utils/date-format"
import { PROJECTS_PAGE_SIZE, buildProjectCards, pageOf } from "~/utils/project-grid"
import AppEmptyState from "~/components/common/app-empty-state.vue"
import AppLoadingSkeleton from "~/components/common/app-loading-skeleton.vue"

useHead({ title: "Projects" })

const toast = useToast()
const route = useRoute()
const router = useRouter()

// If the project-exists middleware bounced us here, surface a toast once.
// Also clear the `last-project-id` cookie so the sidebar stops rendering
// project-scoped links to the dead UUID — otherwise clicking Overview (or
// any other item) would bounce the user right back here in a loop.
const lastProjectId = useCookie<string | null>("last-project-id")
onMounted(() => {
  if (route.query.error === "project-not-found") {
    toast.add({
      title: "Project not found",
      description: "The project you tried to open doesn't exist or you don't have access.",
      color: "error",
      icon: "i-heroicons-exclamation-triangle",
    })
    lastProjectId.value = null
    router.replace({ query: {} })
  }
})
const { data: projects, pending, refresh } = await useProjectsList()
// Per-project numbers load alongside the names; cards render with zeros
// until they arrive so the grid never waits on the aggregate.
const { data: stats, refresh: refreshStats } = useApi<ProjectStatsDTO[]>("/api/projects/stats", {
  key: "projects-stats",
  default: () => [],
  lazy: true,
})

const list = computed(() => projects.value ?? [])
const cards = computed(() => buildProjectCards(list.value, stats.value ?? []))

// Page lives in the URL so back/forward and reloads keep the user's place.
const page = computed(() => {
  const raw = Number(route.query.page)
  return Number.isInteger(raw) && raw > 0 ? raw : 1
})
const paged = computed(() => pageOf(cards.value, page.value))
function goToPage(next: number) {
  router.replace({ query: { ...route.query, page: next > 1 ? String(next) : undefined } })
}

const now = useNow({ interval: 60_000 })
function lastSeen(iso: string | null): string {
  return iso ? formatRelative(iso, { now: now.value.getTime() }) : "No reports yet"
}

const newOpen = ref(false)
const newName = ref("")
const creating = ref(false)

// Any authenticated user can create a project — the server's POST /api/projects
// only calls requireSession (not requireInstallAdmin). The UI mirrors that.
const { session } = useSession()
const canCreate = computed(() => Boolean(session.value?.data?.user))

async function createProject() {
  if (!newName.value.trim()) return
  creating.value = true
  try {
    const created = await $fetch<ProjectDTO>("/api/projects", {
      method: "POST",
      credentials: "include",
      body: { name: newName.value.trim() },
    })
    toast.add({
      title: "Project created",
      description: "Next: install the SDK and add an allowed origin.",
      color: "success",
      icon: "i-heroicons-check-circle",
    })
    newOpen.value = false
    newName.value = ""
    // Land inside the new project — its Overview carries the setup checklist
    // and the embed snippet, which is what a fresh project needs next.
    await Promise.all([refresh(), refreshStats()])
    await navigateTo(`/projects/${created.id}`)
  } catch (err) {
    toast.add({
      title: "Could not create project",
      description: describeApiError(err),
      color: "error",
      icon: "i-heroicons-exclamation-triangle",
    })
  } finally {
    creating.value = false
  }
}
</script>

<template>
  <div class="space-y-8">
    <PageHeader
      eyebrow="Workspace"
      title="Projects"
      description="Each project carries its own SDK key, member list, and inbox. Pick one to triage, or spin up a new one."
    >
      <template v-if="canCreate" #actions>
        <UButton
          label="New project"
          icon="i-heroicons-plus"
          color="primary"
          size="md"
          @click="newOpen = true"
        />
      </template>
    </PageHeader>

    <div
      v-if="pending && list.length === 0"
      class="grid gap-4"
      style="grid-template-columns: repeat(auto-fill, minmax(18rem, 1fr))"
      aria-busy="true"
      aria-label="Loading projects"
    >
      <AppLoadingSkeleton v-for="n in 3" :key="n" variant="card" />
    </div>

    <AppEmptyState
      v-else-if="list.length === 0"
      variant="gradient"
      icon="i-heroicons-squares-plus"
      title="Create your first project"
      description="A project groups incoming reports from a single app or site. You'll get an SDK key once it's created."
      action-label="New project"
      @action="newOpen = true"
    />

    <!-- auto-fill grid — cards size consistently at ~18rem, but only take
         as many columns as they need. 1 project fills 1 column with a tight
         "New project" tile next to it, rather than leaving gaping holes in
         a fixed 3-column layout. -->
    <div v-else class="space-y-4">
      <div
        class="grid gap-4"
        style="grid-template-columns: repeat(auto-fill, minmax(18rem, 1fr))"
        data-testid="projects-grid"
      >
        <NuxtLink
          v-for="({ project: p, stats: s }, i) in paged.items"
          :key="p.id"
          :to="`/projects/${p.id}`"
          class="group relative block overflow-hidden rounded-xl border border-default bg-default p-5 transition duration-300 hover:border-default/80 hover:-translate-y-0.5 hover:shadow-[0_12px_32px_-12px_rgba(0,0,0,0.35)] fade-up"
          :style="{ '--fade-up-delay': `${i * 40}ms` }"
          :data-testid="`project-card-${p.id}`"
        >
          <div class="relative flex items-start gap-3">
            <div
              class="flex items-center justify-center size-9 rounded-lg bg-elevated text-default ring-1 ring-default shrink-0"
            >
              <UIcon name="i-heroicons-folder" class="size-4" />
            </div>
            <div class="min-w-0 flex-1">
              <h3 class="text-base font-semibold text-default tracking-tight truncate">
                {{ p.name }}
              </h3>
              <div class="mt-1 flex items-center gap-2 text-xs text-muted min-w-0">
                <span
                  class="inline-flex items-center gap-1.5 font-medium uppercase tracking-wider shrink-0"
                >
                  <span
                    class="inline-block size-1.5 rounded-full"
                    :class="p.effectiveRole === 'owner' ? 'bg-warning' : 'bg-muted/70'"
                  />
                  {{ p.effectiveRole }}
                </span>
                <template v-if="s.github">
                  <span aria-hidden="true">·</span>
                  <span
                    class="inline-flex items-center gap-1 min-w-0"
                    :title="`Synced with GitHub ${s.github.repoOwner}/${s.github.repoName}`"
                  >
                    <UIcon name="i-simple-icons-github" class="size-3 shrink-0" />
                    <span class="truncate">{{ s.github.repoOwner }}/{{ s.github.repoName }}</span>
                  </span>
                </template>
              </div>
            </div>
            <UIcon
              name="i-heroicons-arrow-up-right"
              class="size-4 text-muted opacity-0 -translate-x-1 transition-all duration-300 group-hover:opacity-100 group-hover:translate-x-0 group-hover:text-default"
            />
          </div>

          <dl class="mt-4 grid grid-cols-3 gap-2">
            <div class="rounded-lg bg-elevated/60 px-2.5 py-2">
              <dt class="text-[10px] font-medium uppercase tracking-wider text-muted">Open</dt>
              <dd
                class="mt-0.5 text-lg font-semibold tabular-nums tracking-tight"
                :class="s.openCount > 0 ? 'text-default' : 'text-muted'"
              >
                {{ s.openCount }}
              </dd>
            </div>
            <div class="rounded-lg bg-elevated/60 px-2.5 py-2">
              <dt class="text-[10px] font-medium uppercase tracking-wider text-muted">
                In progress
              </dt>
              <dd
                class="mt-0.5 text-lg font-semibold tabular-nums tracking-tight"
                :class="s.inProgressCount > 0 ? 'text-default' : 'text-muted'"
              >
                {{ s.inProgressCount }}
              </dd>
            </div>
            <div class="rounded-lg bg-elevated/60 px-2.5 py-2">
              <dt class="text-[10px] font-medium uppercase tracking-wider text-muted">7 days</dt>
              <dd
                class="mt-0.5 text-lg font-semibold tabular-nums tracking-tight"
                :class="s.newLast7Count > 0 ? 'text-primary' : 'text-muted'"
              >
                {{ s.newLast7Count > 0 ? `+${s.newLast7Count}` : 0 }}
              </dd>
            </div>
          </dl>

          <div class="mt-3 flex items-center justify-between text-xs text-muted">
            <span class="inline-flex items-center gap-1.5">
              <UIcon name="i-heroicons-clock" class="size-3.5" />
              <span v-if="s.lastReportAt">Last report {{ lastSeen(s.lastReportAt) }}</span>
              <span v-else>No reports yet</span>
            </span>
            <span class="tabular-nums">{{ s.totalCount }} total</span>
          </div>
        </NuxtLink>
        <button
          v-if="canCreate && paged.page === paged.pageCount"
          type="button"
          class="rounded-xl border border-dashed border-default/80 p-5 flex flex-col items-center justify-center text-muted hover:border-default hover:text-default hover:bg-elevated/40 transition-colors fade-up"
          :style="{ '--fade-up-delay': `${paged.items.length * 40}ms` }"
          @click="newOpen = true"
        >
          <UIcon name="i-heroicons-plus" class="size-7" />
          <span class="mt-2 text-sm font-medium">New project</span>
        </button>
      </div>

      <div
        v-if="paged.pageCount > 1"
        class="flex items-center justify-between gap-4"
        data-testid="projects-pagination"
      >
        <span class="text-sm text-muted tabular-nums">
          {{ (paged.page - 1) * PROJECTS_PAGE_SIZE + 1 }}–{{
            Math.min(paged.page * PROJECTS_PAGE_SIZE, cards.length)
          }}
          of {{ cards.length }} projects
        </span>
        <UPagination
          :page="paged.page"
          :total="cards.length"
          :items-per-page="PROJECTS_PAGE_SIZE"
          :sibling-count="1"
          show-edges
          size="sm"
          @update:page="goToPage($event)"
        />
      </div>
    </div>

    <UModal v-model:open="newOpen" :ui="{ content: 'max-w-md' }">
      <template #content>
        <form class="p-6 space-y-5" @submit.prevent="createProject">
          <div class="flex items-start gap-3">
            <div
              class="flex items-center justify-center size-10 rounded-xl bg-primary/10 text-primary ring-1 ring-primary/20 shrink-0"
            >
              <UIcon name="i-heroicons-squares-plus" class="size-5" />
            </div>
            <div class="min-w-0 flex-1">
              <h3 class="text-lg font-semibold text-default tracking-tight">Create project</h3>
              <p class="mt-1 text-sm text-muted">Pick a name. You can rename it any time.</p>
            </div>
          </div>
          <UFormField label="Name" required>
            <UInput v-model="newName" placeholder="My App" autofocus class="w-full" />
          </UFormField>
          <div class="flex justify-end gap-2 pt-1">
            <UButton label="Cancel" color="neutral" variant="ghost" @click="newOpen = false" />
            <UButton type="submit" label="Create project" color="primary" :loading="creating" />
          </div>
        </form>
      </template>
    </UModal>
  </div>
</template>
