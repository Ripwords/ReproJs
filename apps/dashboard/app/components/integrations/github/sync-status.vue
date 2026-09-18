<script setup lang="ts">
import { describeApiError } from "~/utils/api-error"
import RelativeTime from "~/components/common/relative-time.vue"
import type { GithubConfigDTO } from "@reprojs/shared"

interface Props {
  projectId: string
  /** Bulk retry (retry-failed.post) is developer+ on the server. */
  canRetryAll: boolean
  /** Single-report retry (reports/:id/github-sync.post) is manager+. */
  canRetryOne: boolean
}
const props = defineProps<Props>()
const emit = defineEmits<{ retried: [] }>()

const toast = useToast()

const { data, refresh } = useApi<GithubConfigDTO>(
  `/api/projects/${props.projectId}/integrations/github`,
)

const retryingAll = ref(false)
const retryingOne = ref<string | null>(null)

const failedJobs = computed(() => data.value?.failedJobs ?? [])
const failedCount = computed(() => failedJobs.value.length)
const lastSyncedAt = computed(() => data.value?.lastSyncedAt ?? null)

async function retryAll() {
  retryingAll.value = true
  try {
    await $fetch(`/api/projects/${props.projectId}/integrations/github/retry-failed`, {
      method: "POST",
      credentials: "include",
    })
    await refresh()
    emit("retried")
    toast.add({
      title: "Retry queued",
      description: `Retrying ${failedCount.value} failed job${failedCount.value === 1 ? "" : "s"}.`,
      color: "success",
      icon: "i-heroicons-check-circle",
    })
  } catch (err) {
    toast.add({
      title: "Could not retry",
      description: describeApiError(err),
      color: "error",
      icon: "i-heroicons-exclamation-triangle",
    })
  } finally {
    retryingAll.value = false
  }
}

async function retryOne(reportId: string) {
  retryingOne.value = reportId
  try {
    await $fetch(`/api/projects/${props.projectId}/reports/${reportId}/github-sync`, {
      method: "POST",
      credentials: "include",
    })
    await refresh()
    emit("retried")
    toast.add({
      title: "Retry queued",
      color: "success",
      icon: "i-heroicons-check-circle",
    })
  } catch (err) {
    toast.add({
      title: "Retry failed",
      description: describeApiError(err),
      color: "error",
      icon: "i-heroicons-exclamation-triangle",
    })
  } finally {
    retryingOne.value = null
  }
}
</script>

<template>
  <div class="space-y-3">
    <div class="grid grid-cols-2 gap-3">
      <div class="p-4 rounded-lg border border-default bg-default">
        <div class="text-sm font-semibold uppercase tracking-[0.14em] text-muted">Failed</div>
        <div
          class="mt-1 text-2xl font-semibold tabular-nums tracking-tight"
          :class="failedCount > 0 ? 'text-error' : 'text-default'"
        >
          {{ failedCount }}
        </div>
      </div>
      <div class="p-4 rounded-lg border border-default bg-default">
        <div class="text-sm font-semibold uppercase tracking-[0.14em] text-muted">Last sync</div>
        <div class="mt-1 text-base font-semibold text-default">
          <RelativeTime :value="lastSyncedAt" />
        </div>
      </div>
    </div>

    <UButton
      v-if="failedCount > 0"
      label="Retry failed"
      icon="i-heroicons-arrow-path"
      color="neutral"
      variant="outline"
      size="sm"
      block
      :loading="retryingAll"
      :disabled="!canRetryAll"
      @click="retryAll"
    />
    <p v-if="failedCount > 0 && !canRetryAll" class="text-sm text-muted">
      Retrying all failed jobs needs the developer role or higher.
    </p>

    <ul v-if="failedJobs.length > 0" class="space-y-1.5">
      <li
        v-for="j in failedJobs"
        :key="j.reportId"
        class="flex items-start gap-2 rounded-lg border border-error/30 bg-error/5 p-2.5"
      >
        <div class="flex-1 min-w-0">
          <div class="text-sm font-medium text-default truncate">{{ j.reportTitle }}</div>
          <div class="text-sm text-muted truncate mt-0.5">
            {{ j.lastError ?? "Unknown error" }}
          </div>
          <div class="mt-1 text-sm text-muted tabular-nums">
            {{ j.attempts }} attempt{{ j.attempts === 1 ? "" : "s" }} ·
            <RelativeTime :value="j.updatedAt" />
          </div>
        </div>
        <UButton
          label="Retry"
          color="neutral"
          variant="outline"
          size="xs"
          :loading="retryingOne === j.reportId"
          :disabled="!canRetryOne"
          @click="retryOne(j.reportId)"
        />
      </li>
    </ul>
  </div>
</template>
