<script setup lang="ts">
import { describeApiError } from "~/utils/api-error"
import type { GithubRepositoryDTO, GithubRepositoryPageDTO } from "@reprojs/shared"
import { computed, onBeforeUnmount, ref, watch } from "vue"

interface RepoValue {
  owner: string
  name: string
}

interface Props {
  projectId: string
  modelValue: RepoValue
  disabled?: boolean
}
const props = defineProps<Props>()
const emit = defineEmits<{
  "update:modelValue": [RepoValue]
}>()

const PER_PAGE = 30
const DEBOUNCE_MS = 250

const open = ref(false)
const search = ref("")
const repos = ref<GithubRepositoryDTO[]>([])
const page = ref(1)
const hasMore = ref(false)
const loading = ref(false)
const error = ref<string | null>(null)
// Monotonic guard so late-arriving responses from stale queries are dropped.
const requestSeq = ref(0)

const selectedLabel = computed(() => {
  if (!props.modelValue.owner || !props.modelValue.name) return ""
  return `${props.modelValue.owner}/${props.modelValue.name}`
})

async function fetchPage(nextPage: number): Promise<void> {
  const seq = ++requestSeq.value
  loading.value = true
  error.value = null
  try {
    const res = await $fetch<GithubRepositoryPageDTO>(
      `/api/projects/${props.projectId}/integrations/github/repositories`,
      {
        credentials: "include",
        query: {
          page: nextPage,
          per_page: PER_PAGE,
          ...(search.value.trim() ? { q: search.value.trim() } : {}),
        },
      },
    )
    if (seq !== requestSeq.value) return
    repos.value = nextPage === 1 ? res.repos : [...repos.value, ...res.repos]
    page.value = res.page
    hasMore.value = res.hasMore
  } catch (err) {
    if (seq !== requestSeq.value) return
    error.value = describeApiError(err, "Failed to load repositories")
    if (nextPage === 1) repos.value = []
  } finally {
    if (seq === requestSeq.value) loading.value = false
  }
}

function resetAndFetch() {
  repos.value = []
  page.value = 1
  hasMore.value = false
  fetchPage(1)
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null
watch(search, () => {
  if (!open.value) return
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    resetAndFetch()
  }, DEBOUNCE_MS)
})

watch(open, (isOpen) => {
  if (!isOpen) return
  // Always re-fetch on open so cache invalidations from webhooks show up.
  resetAndFetch()
})

onBeforeUnmount(() => {
  if (debounceTimer) clearTimeout(debounceTimer)
})

// IntersectionObserver on a sentinel at the bottom of the list.
const sentinel = ref<HTMLElement | null>(null)
let observer: IntersectionObserver | null = null

function attachObserver(el: HTMLElement | null) {
  observer?.disconnect()
  observer = null
  if (!el) return
  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting && hasMore.value && !loading.value) {
          fetchPage(page.value + 1)
        }
      }
    },
    { threshold: 0.1 },
  )
  observer.observe(el)
}
watch(sentinel, attachObserver)
onBeforeUnmount(() => observer?.disconnect())

function pick(r: GithubRepositoryDTO) {
  emit("update:modelValue", { owner: r.owner, name: r.name })
  open.value = false
}

const isSelected = (r: GithubRepositoryDTO) =>
  r.owner === props.modelValue.owner && r.name === props.modelValue.name
</script>

<template>
  <UPopover
    v-model:open="open"
    :content="{ align: 'start', sideOffset: 4 }"
    :ui="{ content: 'w-[min(28rem,calc(100vw-2rem))] p-0' }"
  >
    <UButton
      :label="selectedLabel || 'Select a repository'"
      color="neutral"
      variant="outline"
      size="sm"
      trailing-icon="i-heroicons-chevron-up-down"
      :disabled="disabled"
      class="w-full justify-between"
    />
    <template #content>
      <div class="flex flex-col">
        <div class="p-2 border-b border-default">
          <UInput
            v-model="search"
            placeholder="Search repositories…"
            icon="i-heroicons-magnifying-glass"
            size="sm"
            autofocus
            class="w-full"
          />
        </div>
        <div class="max-h-72 overflow-y-auto" role="listbox">
          <button
            v-for="r in repos"
            :key="r.id"
            type="button"
            role="option"
            :aria-selected="isSelected(r)"
            class="w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-left text-default hover:bg-elevated focus:bg-elevated focus:outline-none"
            :class="{ 'bg-elevated': isSelected(r) }"
            @click="pick(r)"
          >
            <span class="truncate">{{ r.fullName }}</span>
            <UIcon
              v-if="isSelected(r)"
              name="i-heroicons-check"
              class="size-4 text-primary shrink-0"
            />
          </button>

          <div v-if="loading" class="px-3 py-3 text-sm text-muted flex items-center gap-2">
            <UIcon name="i-heroicons-arrow-path" class="size-4 animate-spin" />
            Loading…
          </div>
          <div
            v-else-if="error"
            class="px-3 py-3 text-sm text-error flex items-center justify-between gap-2"
          >
            <span class="truncate">{{ error }}</span>
            <button type="button" class="underline shrink-0" @click="resetAndFetch">retry</button>
          </div>
          <div v-else-if="repos.length === 0" class="px-3 py-4 text-sm text-muted text-center">
            No repositories found
          </div>

          <div v-if="hasMore" ref="sentinel" class="h-4" />
        </div>
      </div>
    </template>
  </UPopover>
</template>
