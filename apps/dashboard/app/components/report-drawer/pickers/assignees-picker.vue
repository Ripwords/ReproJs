<!-- report-drawer/pickers/assignees-picker.vue
     GitHub-style assignee selector. Selected assignees are listed as
     avatar + name rows below a minimal trigger, matching GitHub's issue
     sidebar layout. The value emitted is a list of GitHub logins —
     assignees are a GitHub-only concept in this app, so anyone who isn't
     a repo collaborator can't appear here. -->
<script setup lang="ts">
import type { GithubAssignableUserListDTO } from "@reprojs/shared"

const props = defineProps<{
  projectId: string
  modelValue: string[]
  disabled?: boolean
}>()
const emit = defineEmits<{
  "update:modelValue": [value: string[]]
}>()

const searchTerm = ref("")

const { data, pending } = useFetch<GithubAssignableUserListDTO>(
  () =>
    `/api/projects/${props.projectId}/integrations/github/assignable-users?q=${encodeURIComponent(searchTerm.value)}`,
  { default: () => ({ items: [] }), watch: [searchTerm] },
)

// USelectMenu option shape. `linkedUser` is kept as a display hint — if the
// collaborator happens to have linked their GitHub identity to a dashboard
// account, we show their dashboard display name as the primary label and
// their `@login` as the sublabel. We don't emit the dashboard user id.
const options = computed(() =>
  (data.value?.items ?? []).map((opt) => ({
    key: opt.login,
    label: opt.linkedUser?.name ?? opt.login,
    sublabel: opt.linkedUser ? `@${opt.login}` : null,
    ...(opt.avatarUrl ? { avatar: { src: opt.avatarUrl, alt: opt.login } } : {}),
  })),
)

// Quick lookup from login → option so the selected-rows view renders avatar
// + name without waiting for another round-trip.
const byLogin = computed(() => {
  const m = new Map<
    string,
    { login: string; label: string; sublabel: string | null; avatarUrl: string | null }
  >()
  for (const opt of data.value?.items ?? []) {
    m.set(opt.login, {
      login: opt.login,
      label: opt.linkedUser?.name ?? opt.login,
      sublabel: opt.linkedUser ? `@${opt.login}` : null,
      avatarUrl: opt.avatarUrl,
    })
  }
  return m
})

const selectedKeys = computed({
  get: () => props.modelValue,
  set: (logins: string[]) => {
    if (logins.length > 10) return
    emit("update:modelValue", logins)
  },
})

// Selected-rows display: avatar + primary + secondary, same ordering as the
// value prop. Falls back to the raw login if the picker dataset hasn't
// loaded yet (rare — picker loads eagerly) or a webhook-pushed login isn't
// in the current search window.
const selectedRows = computed(() =>
  selectedKeys.value.map((login) => {
    const hit = byLogin.value.get(login)
    if (hit) return hit
    return { login, label: login, sublabel: null, avatarUrl: null as string | null }
  }),
)

function removeOne(login: string) {
  if (props.disabled) return
  selectedKeys.value = selectedKeys.value.filter((l) => l !== login)
}
</script>

<template>
  <div class="space-y-2">
    <USelectMenu
      v-model="selectedKeys"
      v-model:search-term="searchTerm"
      :items="options"
      value-key="key"
      label-key="label"
      multiple
      :loading="pending"
      :disabled="disabled"
      size="sm"
      variant="outline"
      class="w-full"
      :ui="{ base: 'justify-between' }"
    >
      <template #default>
        <span class="inline-flex items-center gap-1.5 text-muted">
          <UIcon name="i-lucide-users" class="size-3.5" />
          <span>
            {{
              selectedKeys.length > 0
                ? `Manage ${selectedKeys.length} assignee${selectedKeys.length === 1 ? "" : "s"}`
                : "Add assignees"
            }}
          </span>
        </span>
      </template>

      <template #option="{ option }">
        <UAvatar
          v-if="option.avatar"
          :src="option.avatar.src"
          :alt="option.avatar.alt"
          size="xs"
          class="mr-2 shrink-0"
        />
        <UAvatar
          v-else
          :text="option.label.slice(0, 2).toUpperCase()"
          size="xs"
          class="mr-2 shrink-0"
        />
        <div class="flex-1 min-w-0">
          <div class="truncate">{{ option.label }}</div>
          <div v-if="option.sublabel" class="text-sm text-muted truncate">
            {{ option.sublabel }}
          </div>
        </div>
      </template>
    </USelectMenu>

    <!-- Selected assignees: stacked avatar + name rows, GitHub-sidebar style.
         Hover reveals an × to remove. Whole row is clickable via the button. -->
    <ul v-if="selectedRows.length" role="list" class="flex flex-col gap-1 pt-1">
      <li v-for="row in selectedRows" :key="row.login">
        <button
          type="button"
          class="group w-full flex items-center gap-2 px-1.5 py-1 rounded-md text-left transition-colors hover:bg-elevated/60 disabled:cursor-not-allowed disabled:opacity-60"
          :disabled="disabled"
          :title="`Remove ${row.label}`"
          :aria-label="`Remove ${row.label}`"
          @click="removeOne(row.login)"
        >
          <UAvatar
            v-if="row.avatarUrl"
            :src="row.avatarUrl"
            :alt="row.label"
            size="xs"
            class="shrink-0"
          />
          <UAvatar v-else :text="row.label.slice(0, 2).toUpperCase()" size="xs" class="shrink-0" />

          <div class="min-w-0 flex-1 leading-tight">
            <div class="truncate text-sm font-medium text-default">{{ row.label }}</div>
            <div v-if="row.sublabel" class="truncate text-sm text-muted">
              {{ row.sublabel }}
            </div>
          </div>

          <UIcon
            name="i-lucide-x"
            class="size-4 shrink-0 text-muted opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
          />
        </button>
      </li>
    </ul>
  </div>
</template>
