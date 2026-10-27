<!-- integrations/github/link-issue-dialog.vue
     Attach a report to a GitHub issue that already exists in the project's
     repository. Two ways to pick the issue:

       1. Search open issues (debounced query against the issues endpoint).
       2. Paste a URL or number; the server verifies it and returns a preview
          so a wrong number shows an obviously wrong title before anything is
          posted.

     Owns the POST. The server writes the link (`attached`) inside the request,
     so a 2xx means the report is linked — we emit `attached` right away and
     the parent refetches. Only the comment on the issue is posted later by
     the async reconcile. -->
<script setup lang="ts">
import { describeApiError } from "~/utils/api-error"
import { parseRelatedIssueNumber } from "@reprojs/shared"
import type {
  GithubIssueListDTO,
  GithubIssueSummaryDTO,
  LinkGithubIssueBody,
} from "@reprojs/shared"
import RelativeTime from "~/components/common/relative-time.vue"

interface Props {
  projectId: string
  reportId: string
  open: boolean
  /** Pre-fill the paste tab (e.g. from the reporter's hint) and fetch its preview. */
  initialIssueNumber?: number | null
}
const props = withDefaults(defineProps<Props>(), { initialIssueNumber: null })

const emit = defineEmits<{
  "update:open": [boolean]
  attached: [issueNumber: number]
}>()

const toast = useToast()

type Tab = "search" | "paste"
const tabs: { label: string; value: Tab; icon: string }[] = [
  { label: "Search open issues", value: "search", icon: "i-heroicons-magnifying-glass" },
  { label: "Paste URL or number", value: "paste", icon: "i-heroicons-link" },
]
const activeTab = ref<Tab>("search")

const DEBOUNCE_MS = 250
const issuesBase = computed(() => `/api/projects/${props.projectId}/integrations/github/issues`)

// ---- Search tab ----
const query = ref("")
const results = ref<GithubIssueSummaryDTO[]>([])
const searching = ref(false)
const searchError = ref<string | null>(null)
const selected = ref<GithubIssueSummaryDTO | null>(null)
// Monotonic guard so late-arriving responses from stale queries are dropped.
let searchSeq = 0

async function runSearch(): Promise<void> {
  const seq = ++searchSeq
  searching.value = true
  searchError.value = null
  try {
    const q = query.value.trim()
    const res = await $fetch<GithubIssueListDTO>(issuesBase.value, {
      credentials: "include",
      query: { state: "open", page: 1, ...(q ? { q } : {}) },
    })
    if (seq !== searchSeq) return
    results.value = res.items
  } catch (err) {
    if (seq !== searchSeq) return
    results.value = []
    searchError.value = describeApiError(err, "Could not load issues")
  } finally {
    if (seq === searchSeq) searching.value = false
  }
}

let searchTimer: ReturnType<typeof setTimeout> | null = null
function onQueryInput(value: string | number) {
  query.value = String(value)
  selected.value = null
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => void runSearch(), DEBOUNCE_MS)
}

// ---- Paste tab ----
const pasteText = ref("")
const pastedNumber = computed(() => parseRelatedIssueNumber(pasteText.value))
const preview = ref<GithubIssueSummaryDTO | null>(null)
const previewLoading = ref(false)
const previewError = ref<string | null>(null)
let previewSeq = 0

async function fetchPreview(n: number): Promise<void> {
  const seq = ++previewSeq
  previewLoading.value = true
  previewError.value = null
  preview.value = null
  try {
    const res = await $fetch<GithubIssueSummaryDTO>(`${issuesBase.value}/${n}`, {
      credentials: "include",
    })
    if (seq !== previewSeq) return
    preview.value = res
  } catch (err) {
    if (seq !== previewSeq) return
    const status = (err as { statusCode?: unknown }).statusCode
    previewError.value =
      status === 404
        ? `Issue #${n} was not found in the connected repository (pull requests can't be used).`
        : describeApiError(err, "Could not look up the issue")
  } finally {
    if (seq === previewSeq) previewLoading.value = false
  }
}

let previewTimer: ReturnType<typeof setTimeout> | null = null
function onPasteInput(value: string | number) {
  pasteText.value = String(value)
  if (previewTimer) clearTimeout(previewTimer)
  previewSeq++ // invalidate any in-flight lookup for the previous number
  preview.value = null
  previewError.value = null
  previewLoading.value = false
  const n = pastedNumber.value
  if (n === null) return
  previewTimer = setTimeout(() => void fetchPreview(n), DEBOUNCE_MS)
}

const pasteHint = computed(() => {
  if (!pasteText.value.trim() || pastedNumber.value !== null) return null
  return "Enter an issue number (#42), owner/repo#42, or a GitHub issue URL."
})

// ---- Confirm ----
const chosen = computed<GithubIssueSummaryDTO | null>(() =>
  activeTab.value === "search" ? selected.value : preview.value,
)
const submitting = ref(false)

const abort = new AbortController()
onUnmounted(() => {
  abort.abort()
  if (searchTimer) clearTimeout(searchTimer)
  if (previewTimer) clearTimeout(previewTimer)
})

async function confirm(): Promise<void> {
  const issue = chosen.value
  if (!issue || submitting.value) return
  submitting.value = true
  try {
    const body: LinkGithubIssueBody = { issueNumber: issue.number }
    await $fetch(`/api/projects/${props.projectId}/reports/${props.reportId}/github-link`, {
      method: "POST",
      credentials: "include",
      body,
      signal: abort.signal,
    })
    if (abort.signal.aborted) return
    emit("attached", issue.number)
    emit("update:open", false)
    toast.add({
      title: `Attached to #${issue.number}`,
      description: "Repro is posting the report as a comment on the issue.",
      color: "success",
      icon: "i-heroicons-check-circle",
    })
  } catch (err) {
    if (abort.signal.aborted) return
    toast.add({
      title: "Could not attach to the issue",
      description: describeApiError(err),
      color: "error",
      icon: "i-heroicons-exclamation-triangle",
    })
  } finally {
    submitting.value = false
  }
}

function reset() {
  searchSeq++
  previewSeq++
  query.value = ""
  results.value = []
  searching.value = false
  searchError.value = null
  selected.value = null
  pasteText.value = ""
  preview.value = null
  previewLoading.value = false
  previewError.value = null
}

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return
    reset()
    if (props.initialIssueNumber !== null) {
      activeTab.value = "paste"
      pasteText.value = `#${props.initialIssueNumber}`
      void fetchPreview(props.initialIssueNumber)
    } else {
      activeTab.value = "search"
    }
    // Always load the first page so the search tab isn't empty on open.
    void runSearch()
  },
)

function onOpenChange(v: boolean) {
  emit("update:open", v)
}

function stateColor(state: GithubIssueSummaryDTO["state"]): "success" | "neutral" {
  return state === "open" ? "success" : "neutral"
}
</script>

<template>
  <UModal :open="open" :ui="{ content: 'max-w-lg' }" @update:open="onOpenChange">
    <template #content>
      <div class="p-6 space-y-4">
        <div>
          <h3 class="text-lg font-semibold text-default">Attach to an existing GitHub issue</h3>
          <p class="mt-1 text-sm text-muted">
            Pick the issue this report belongs to. Nothing is posted until you confirm.
          </p>
        </div>

        <UTabs
          v-model="activeTab"
          :items="tabs"
          value-key="value"
          :content="false"
          size="sm"
          class="w-full"
        />

        <!-- Search tab -->
        <div v-if="activeTab === 'search'" class="space-y-2">
          <UInput
            :model-value="query"
            placeholder="Search open issues by title…"
            icon="i-heroicons-magnifying-glass"
            size="md"
            autofocus
            class="w-full"
            @update:model-value="onQueryInput"
          />
          <div class="max-h-72 overflow-y-auto rounded-lg border border-default" role="listbox">
            <button
              v-for="issue in results"
              :key="issue.number"
              type="button"
              role="option"
              :aria-selected="selected?.number === issue.number"
              class="w-full flex items-start gap-2.5 px-3 py-2 text-left text-sm text-default hover:bg-elevated focus:bg-elevated focus:outline-none border-b border-default/60 last:border-b-0"
              :class="{ 'bg-elevated': selected?.number === issue.number }"
              @click="selected = issue"
            >
              <span class="shrink-0 font-mono text-muted tabular-nums">#{{ issue.number }}</span>
              <span class="min-w-0 flex-1 truncate">{{ issue.title }}</span>
              <UBadge :color="stateColor(issue.state)" variant="subtle" size="xs" class="shrink-0">
                {{ issue.state }}
              </UBadge>
              <span class="shrink-0 text-xs text-dimmed">
                <RelativeTime :value="issue.updatedAt" compact />
              </span>
            </button>

            <div
              v-if="searching && results.length === 0"
              class="px-3 py-3 text-sm text-muted flex items-center gap-2"
            >
              <UIcon name="i-heroicons-arrow-path" class="size-4 animate-spin" />
              Loading issues…
            </div>
            <div
              v-else-if="searchError"
              class="px-3 py-3 text-sm text-error flex items-center justify-between gap-2"
            >
              <span class="truncate">{{ searchError }}</span>
              <button type="button" class="underline shrink-0" @click="runSearch">retry</button>
            </div>
            <div v-else-if="results.length === 0" class="px-3 py-4 text-sm text-muted text-center">
              No open issues match.
            </div>
          </div>
        </div>

        <!-- Paste tab -->
        <div v-else class="space-y-2">
          <UInput
            :model-value="pasteText"
            placeholder="#123 or https://github.com/owner/repo/issues/123"
            icon="i-heroicons-link"
            size="md"
            autofocus
            class="w-full"
            @update:model-value="onPasteInput"
            @keydown.enter.prevent="confirm"
          />
          <p v-if="pasteHint" class="text-sm text-muted">{{ pasteHint }}</p>

          <div
            v-if="previewLoading"
            class="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-default bg-elevated/40 text-sm text-muted"
            role="status"
          >
            <UIcon name="i-heroicons-arrow-path" class="size-4 animate-spin shrink-0" />
            <span>Looking up #{{ pastedNumber }}…</span>
          </div>
          <div
            v-else-if="previewError"
            class="flex items-start gap-2 px-3 py-2.5 rounded-lg border border-error/30 bg-error/5 text-sm text-error"
            role="alert"
          >
            <UIcon name="i-heroicons-exclamation-triangle" class="size-4 shrink-0 mt-0.5" />
            <span class="break-words">{{ previewError }}</span>
          </div>
          <div
            v-else-if="preview"
            class="flex items-start gap-2.5 px-3 py-2.5 rounded-lg border border-default bg-elevated/40 text-sm"
          >
            <UIcon name="i-simple-icons-github" class="size-4 shrink-0 mt-0.5 text-default" />
            <div class="min-w-0 flex-1">
              <p class="text-default">
                <span class="font-mono text-muted">#{{ preview.number }}</span>
                <span class="ml-1.5 font-medium break-words">{{ preview.title }}</span>
              </p>
              <p class="mt-1 flex items-center gap-2 text-xs text-dimmed">
                <UBadge :color="stateColor(preview.state)" variant="subtle" size="xs">
                  {{ preview.state }}
                </UBadge>
                <span>updated <RelativeTime :value="preview.updatedAt" compact /></span>
              </p>
            </div>
          </div>
        </div>

        <div class="flex flex-col gap-2 pt-1">
          <div class="flex justify-end gap-2">
            <UButton
              label="Cancel"
              color="neutral"
              variant="ghost"
              :disabled="submitting"
              @click="onOpenChange(false)"
            />
            <UButton
              :label="chosen ? `Attach report as comment on #${chosen.number}` : 'Attach report'"
              icon="i-simple-icons-github"
              :loading="submitting"
              :disabled="!chosen"
              @click="confirm"
            />
          </div>
          <p class="text-xs text-muted leading-relaxed">
            Repro posts this report (screenshot, environment, logs) as a comment on the issue. The
            report then follows the issue's status, labels and assignees.
          </p>
        </div>
      </div>
    </template>
  </UModal>
</template>
