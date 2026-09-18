<script setup lang="ts">
import { describeApiError } from "~/utils/api-error"
/**
 * Dual-mode confirmation dialog:
 *
 *  1. `mode="disconnect-integration"` — confirms disconnecting the GitHub
 *     integration for an entire project. Owns the POST, emits `@confirmed`.
 *     Used by `github-panel.vue`.
 *
 *  2. `mode="unlink-report"` (default) — confirms unlinking a single report
 *     from its GitHub issue. Presentation-only: the parent owns the POST via
 *     `@confirm` / `@cancel`. Used by `report-drawer/triage-footer.vue`.
 */

interface Props {
  open: boolean
  mode?: "disconnect-integration" | "unlink-report"
  // Disconnect-integration mode:
  projectId?: string
  // Unlink-report mode:
  issueNumber?: number
  repoFullName?: string
}

const props = withDefaults(defineProps<Props>(), {
  mode: "unlink-report",
  projectId: undefined,
  issueNumber: undefined,
  repoFullName: undefined,
})

const emit = defineEmits<{
  "update:open": [boolean]
  confirm: [] // report-unlink mode
  cancel: [] // report-unlink mode
  confirmed: [] // disconnect-integration mode (post success)
}>()

const toast = useToast()
const submitting = ref(false)

const isDisconnect = computed(() => props.mode === "disconnect-integration")

const title = computed(() =>
  isDisconnect.value
    ? "Disconnect GitHub?"
    : `Unlink this report from issue #${props.issueNumber ?? ""}?`,
)

const description = computed(() => {
  if (isDisconnect.value) {
    return "Existing issues remain on GitHub but new reports will stop syncing. You can reconnect any time."
  }
  return props.repoFullName
    ? `The GitHub issue will stay open in ${props.repoFullName} but won't sync with the dashboard anymore. You can create a new issue afterward.`
    : "The GitHub issue will stay open but won't sync with the dashboard anymore. You can create a new issue afterward."
})

const confirmLabel = computed(() => (isDisconnect.value ? "Disconnect" : "Unlink"))

function cancel() {
  emit("update:open", false)
  if (!isDisconnect.value) emit("cancel")
}

function onOpenChange(v: boolean) {
  emit("update:open", v)
  // When closing via backdrop/esc in report-unlink mode, also notify parent
  // so its `unlinkOpen` ref stays in sync (triage-footer uses @cancel only).
  if (!v && !isDisconnect.value) emit("cancel")
}

async function confirm() {
  if (isDisconnect.value) {
    if (!props.projectId) return
    submitting.value = true
    try {
      await $fetch(`/api/projects/${props.projectId}/integrations/github/disconnect`, {
        method: "POST",
        credentials: "include",
      })
      emit("update:open", false)
      emit("confirmed")
      toast.add({
        title: "GitHub disconnected",
        color: "success",
        icon: "i-heroicons-check-circle",
      })
    } catch (err) {
      toast.add({
        title: "Could not disconnect",
        description: describeApiError(err),
        color: "error",
        icon: "i-heroicons-exclamation-triangle",
      })
    } finally {
      submitting.value = false
    }
    return
  }
  // Report-unlink mode: parent owns the POST.
  emit("confirm")
}
</script>

<template>
  <UModal :open="open" :ui="{ content: 'max-w-md' }" @update:open="onOpenChange">
    <template #content>
      <div class="p-6 space-y-4">
        <h3 class="text-lg font-semibold text-default">{{ title }}</h3>
        <p class="text-sm text-muted">{{ description }}</p>
        <div class="flex justify-end gap-2">
          <UButton label="Cancel" color="neutral" variant="ghost" @click="cancel" />
          <UButton :label="confirmLabel" color="error" :loading="submitting" @click="confirm" />
        </div>
      </div>
    </template>
  </UModal>
</template>
