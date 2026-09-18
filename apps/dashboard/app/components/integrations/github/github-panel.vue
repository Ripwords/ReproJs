<script setup lang="ts">
import type { GithubConfigDTO, ProjectDTO } from "@reprojs/shared"
import { hasProjectRole } from "~/utils/project-role"
import RepoPicker from "./repo-picker.vue"
import SyncStatus from "./sync-status.vue"
import UnlinkDialog from "./unlink-dialog.vue"

interface Props {
  projectId: string
}
const props = defineProps<Props>()

const toast = useToast()

const { data, refresh } = useApi<GithubConfigDTO>(
  `/api/projects/${props.projectId}/integrations/github`,
)

// Same role source as the project settings and members pages. Install,
// save and disconnect are owner-only on the server; bulk retry is
// developer+ and a single-report retry is manager+.
const { data: project } = useApi<ProjectDTO>(`/api/projects/${props.projectId}`)
const isOwner = computed(() => hasProjectRole(project.value?.effectiveRole, "owner"))
const canRetryAll = computed(() => hasProjectRole(project.value?.effectiveRole, "developer"))
const canRetryOne = computed(() => hasProjectRole(project.value?.effectiveRole, "manager"))

const selectedRepo = ref({ owner: "", name: "" })
const labelsText = ref("")
const assigneesText = ref("")
const pushOnEdit = ref(false)
const autoCreateOnIntake = ref(false)
const saving = ref(false)
const installing = ref(false)
const unlinkOpen = ref(false)

watch(
  data,
  (v) => {
    if (!v) return
    selectedRepo.value = { owner: v.repoOwner, name: v.repoName }
    labelsText.value = v.defaultLabels.join(", ")
    assigneesText.value = v.defaultAssignees.join(", ")
    pushOnEdit.value = v.pushOnEdit
    autoCreateOnIntake.value = v.autoCreateOnIntake
  },
  { immediate: true },
)

const isInstalled = computed(() => Boolean(data.value?.installed))
const isConnected = computed(() => data.value?.status === "connected")

const statusLabel = computed(() => {
  if (!data.value?.installed) return "Not connected"
  if (data.value.status === "connected") return "Connected"
  return "Disconnected"
})

const statusColor = computed<"neutral" | "success" | "warning">(() => {
  if (!data.value?.installed) return "neutral"
  if (data.value.status === "connected") return "success"
  return "warning"
})

const ctaLabel = computed(() =>
  data.value?.installed && data.value.status === "disconnected"
    ? "Reconnect on GitHub"
    : "Install on GitHub",
)

async function startInstall() {
  installing.value = true
  try {
    const { url } = await $fetch<{ url: string }>(
      `/api/projects/${props.projectId}/integrations/github/install-redirect`,
      { method: "POST", credentials: "include" },
    )
    window.location.href = url
  } catch (err) {
    installing.value = false
    toast.add({
      title: "Could not start install flow",
      description: err instanceof Error ? err.message : undefined,
      color: "error",
      icon: "i-heroicons-exclamation-triangle",
    })
  }
}

async function saveRepo() {
  saving.value = true
  try {
    await $fetch(`/api/projects/${props.projectId}/integrations/github`, {
      method: "PATCH",
      credentials: "include",
      body: {
        repoOwner: selectedRepo.value.owner,
        repoName: selectedRepo.value.name,
        defaultLabels: labelsText.value
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        defaultAssignees: assigneesText.value
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        pushOnEdit: pushOnEdit.value,
        autoCreateOnIntake: autoCreateOnIntake.value,
      },
    })
    await refresh()
    toast.add({
      title: "Saved",
      color: "success",
      icon: "i-heroicons-check-circle",
    })
  } catch (err) {
    toast.add({
      title: "Could not save",
      description: err instanceof Error ? err.message : undefined,
      color: "error",
      icon: "i-heroicons-exclamation-triangle",
    })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UCard :ui="{ header: 'p-5', body: 'p-5' }">
    <template #header>
      <div class="flex items-center gap-3">
        <div
          class="flex items-center justify-center size-10 rounded-lg bg-elevated text-default ring-1 ring-default shrink-0"
        >
          <UIcon name="i-simple-icons-github" class="size-5" />
        </div>
        <div class="flex-1 min-w-0">
          <h2 class="text-base font-semibold text-default tracking-tight">GitHub Issues</h2>
          <p class="text-sm text-muted mt-0.5">
            Turn reports into GitHub issues, one at a time or automatically, and sync status both
            ways.
          </p>
        </div>
        <UBadge :label="statusLabel" :color="statusColor" variant="soft" size="md" />
      </div>
    </template>

    <!-- Not installed yet -->
    <div v-if="!isInstalled" class="space-y-4">
      <p class="text-sm text-muted leading-relaxed">
        Install the GitHub App on a repository to start syncing reports as issues.
      </p>
      <p v-if="!isOwner" class="text-sm text-muted">
        Only project owners can connect the GitHub App.
      </p>
      <UButton
        :label="ctaLabel"
        :loading="installing"
        :disabled="!isOwner"
        icon="i-simple-icons-github"
        color="neutral"
        variant="solid"
        size="md"
        @click="startInstall"
      />
    </div>

    <!-- Installed but disconnected (App uninstalled / access revoked) -->
    <div v-else-if="!isConnected" class="space-y-4">
      <UAlert
        color="warning"
        variant="soft"
        icon="i-heroicons-exclamation-triangle"
        title="Integration disconnected"
        description="The GitHub App was uninstalled or access was revoked. Reconnect to resume syncing."
      />
      <p v-if="!isOwner" class="text-sm text-muted">
        Only project owners can connect the GitHub App.
      </p>
      <UButton
        :label="ctaLabel"
        :loading="installing"
        :disabled="!isOwner"
        icon="i-simple-icons-github"
        color="neutral"
        variant="solid"
        size="md"
        @click="startInstall"
      />
    </div>

    <!-- Installed + connected -->
    <div v-else class="space-y-5">
      <p v-if="!isOwner" class="text-sm text-muted">
        Only project owners can change the repository, defaults, or connection.
      </p>
      <div>
        <div class="text-sm font-semibold uppercase tracking-[0.14em] text-muted mb-2">
          Repository
        </div>
        <RepoPicker
          v-model="selectedRepo"
          :project-id="projectId"
          :disabled="!isOwner"
          @update:model-value="saveRepo"
        />
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <UFormField label="Default labels">
          <UInput
            v-model="labelsText"
            placeholder="bug, triage"
            :disabled="!isOwner"
            class="w-full"
          />
        </UFormField>
        <UFormField label="Default assignees">
          <UInput
            v-model="assigneesText"
            placeholder="octocat, hubot"
            :disabled="!isOwner"
            class="w-full"
          />
        </UFormField>
      </div>

      <div class="flex items-center gap-3">
        <USwitch v-model="pushOnEdit" :disabled="!isOwner" />
        <div>
          <p class="text-sm font-medium text-default">Push edits to GitHub</p>
          <p class="text-sm text-muted">
            Sync priority, status, and label changes back to the GitHub issue automatically.
          </p>
        </div>
      </div>

      <div class="flex items-center gap-3">
        <USwitch
          v-model="autoCreateOnIntake"
          :disabled="!isOwner || !selectedRepo.owner || !selectedRepo.name"
        />
        <div>
          <p
            class="text-sm font-medium"
            :class="!selectedRepo.owner || !selectedRepo.name ? 'text-muted' : 'text-default'"
          >
            Automatically create a GitHub issue for every new report
          </p>
          <p class="text-sm text-muted">
            When on, every report submitted via the SDK immediately becomes a linked GitHub issue.
            Leave off for manual &ldquo;Create issue&rdquo; per report.
          </p>
        </div>
      </div>

      <div class="flex gap-2">
        <UButton
          label="Save defaults"
          color="primary"
          variant="solid"
          size="md"
          :loading="saving"
          :disabled="!isOwner"
          @click="saveRepo"
        />
      </div>

      <div>
        <div class="text-sm font-semibold uppercase tracking-[0.14em] text-muted mb-2">
          Sync status
        </div>
        <SyncStatus
          :project-id="projectId"
          :can-retry-all="canRetryAll"
          :can-retry-one="canRetryOne"
          @retried="refresh"
        />
      </div>

      <div class="pt-3 border-t border-default">
        <UButton
          label="Disconnect integration"
          color="error"
          variant="soft"
          size="md"
          :disabled="!isOwner"
          @click="unlinkOpen = true"
        />
      </div>
    </div>

    <UnlinkDialog
      v-model:open="unlinkOpen"
      mode="disconnect-integration"
      :project-id="projectId"
      @confirmed="refresh"
    />
  </UCard>
</template>
