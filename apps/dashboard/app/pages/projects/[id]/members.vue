<script setup lang="ts">
import RelativeTime from "~/components/common/relative-time.vue"
import { describeApiError } from "~/utils/api-error"
import { h, resolveComponent } from "vue"
import type { TableColumn } from "@nuxt/ui"
import type {
  ProjectDTO,
  ProjectInvitationDTO,
  ProjectMemberDTO,
  ProjectRole,
} from "@reprojs/shared"

const UAvatar = resolveComponent("UAvatar")
const USelectMenu = resolveComponent("USelectMenu")
const UButton = resolveComponent("UButton")
const UDropdownMenu = resolveComponent("UDropdownMenu")

const route = useRoute()
const projectId = computed(() => String(route.params.id))
const toast = useToast()
const { confirm } = useConfirm()

const { data: project } = await useApi<ProjectDTO>(`/api/projects/${projectId.value}`)
const {
  data: members,
  pending,
  refresh,
} = await useApi<ProjectMemberDTO[]>(`/api/projects/${projectId.value}/members`)
const { data: invitations, refresh: refreshInvites } = await useApi<ProjectInvitationDTO[]>(
  `/api/projects/${projectId.value}/invitations`,
  { default: () => [] },
)

useHead({ title: () => (project.value?.name ? `${project.value.name} · Members` : "Members") })

const membersList = computed<ProjectMemberDTO[]>(() => members.value ?? [])
const isOwner = computed(() => project.value?.effectiveRole === "owner")

const roleOptions = [
  { label: "Owner", value: "owner" },
  { label: "Developer", value: "developer" },
  { label: "Manager", value: "manager" },
  { label: "Viewer", value: "viewer" },
] as const

const inviteOpen = ref(false)
const inviteEmail = ref("")
const inviteRole = ref<ProjectRole>("manager")
const inviting = ref(false)

async function sendInvite() {
  if (!inviteEmail.value) return
  inviting.value = true
  try {
    await $fetch(`/api/projects/${projectId.value}/invitations`, {
      method: "POST",
      credentials: "include",
      body: { email: inviteEmail.value, role: inviteRole.value },
    })
    inviteOpen.value = false
    inviteEmail.value = ""
    inviteRole.value = "manager"
    toast.add({ title: "Invite sent", color: "success", icon: "i-heroicons-check-circle" })
    await Promise.all([refresh(), refreshInvites()])
  } catch (err) {
    toast.add({
      title: "Could not send invite",
      description: describeApiError(err),
      color: "error",
      icon: "i-heroicons-exclamation-triangle",
    })
  } finally {
    inviting.value = false
  }
}

async function updateRole(userId: string, next: ProjectRole) {
  try {
    await $fetch(`/api/projects/${projectId.value}/members/${userId}`, {
      method: "PATCH",
      credentials: "include",
      body: { role: next },
    })
    toast.add({ title: "Role updated", color: "success", icon: "i-heroicons-check-circle" })
    await refresh()
  } catch (err) {
    toast.add({
      title: "Could not update role",
      description: describeApiError(err),
      color: "error",
      icon: "i-heroicons-exclamation-triangle",
    })
  }
}

async function removeMember(userId: string) {
  try {
    await $fetch(`/api/projects/${projectId.value}/members/${userId}`, {
      method: "DELETE",
      credentials: "include",
    })
    toast.add({ title: "Member removed", color: "success", icon: "i-heroicons-check-circle" })
    await refresh()
  } catch (err) {
    toast.add({
      title: "Could not remove member",
      description: describeApiError(err),
      color: "error",
      icon: "i-heroicons-exclamation-triangle",
    })
  }
}

async function resendInvite(id: string) {
  try {
    await $fetch(`/api/projects/${projectId.value}/invitations/${id}/resend`, {
      method: "POST",
      credentials: "include",
    })
    toast.add({ title: "Invitation re-sent", color: "success", icon: "i-heroicons-check-circle" })
    await refreshInvites()
  } catch (err) {
    toast.add({
      title: "Could not resend",
      description: describeApiError(err),
      color: "error",
      icon: "i-heroicons-exclamation-triangle",
    })
  }
}

async function revokeInvite(id: string) {
  const ok = await confirm({
    title: "Revoke invitation?",
    description: "The invitation link will stop working.",
    confirmLabel: "Revoke",
    confirmColor: "error",
  })
  if (!ok) return
  try {
    await $fetch(`/api/projects/${projectId.value}/invitations/${id}`, {
      method: "DELETE",
      credentials: "include",
    })
    toast.add({ title: "Invitation revoked", color: "success", icon: "i-heroicons-check-circle" })
    await refreshInvites()
  } catch (err) {
    toast.add({
      title: "Could not revoke",
      description: describeApiError(err),
      color: "error",
      icon: "i-heroicons-exclamation-triangle",
    })
  }
}

async function confirmRemove(member: ProjectMemberDTO) {
  const ok = await confirm({
    title: "Remove member?",
    description: `${member.email} will lose access to this project.`,
    confirmLabel: "Remove",
    confirmColor: "error",
    icon: "i-heroicons-user-minus",
  })
  if (!ok) return
  void removeMember(member.userId)
}

function roleColor(role: string): "primary" | "neutral" | "warning" | "success" | "info" {
  if (role === "owner") return "warning"
  if (role === "developer") return "primary"
  if (role === "manager") return "info"
  if (role === "viewer") return "neutral"
  return "neutral"
}

function initials(name: string | null, email: string): string {
  const base = name?.trim() || email
  return base.slice(0, 2).toUpperCase()
}

const columns = computed<TableColumn<ProjectMemberDTO>[]>(() => [
  {
    accessorKey: "name",
    header: "Member",
    cell: ({ row }) =>
      h("div", { class: "flex items-center gap-3" }, [
        h(UAvatar, {
          size: "sm",
          alt: row.original.name ?? row.original.email,
          text: initials(row.original.name, row.original.email),
        }),
        h("div", {}, [
          h(
            "div",
            { class: "text-sm font-medium text-default" },
            row.original.name ?? row.original.email,
          ),
          row.original.name ? h("div", { class: "text-sm text-muted" }, row.original.email) : null,
        ]),
      ]),
  },
  {
    accessorKey: "role",
    header: "Role",
    cell: ({ row }) => {
      if (!isOwner.value) {
        const UBadge = resolveComponent("UBadge")
        return h(
          UBadge,
          { color: roleColor(row.original.role), variant: "subtle", size: "sm" },
          () => row.original.role,
        )
      }
      return h(USelectMenu, {
        modelValue: roleOptions.find((o) => o.value === row.original.role),
        items: roleOptions,
        size: "xs",
        "onUpdate:modelValue": (v: { label: string; value: ProjectRole }) => {
          if (v?.value && v.value !== row.original.role) {
            void updateRole(row.original.userId, v.value)
          }
        },
      })
    },
  },
  {
    accessorKey: "joinedAt",
    header: "Joined",
    cell: ({ row }) =>
      h("span", { class: "text-sm text-muted" }, [
        h(RelativeTime, { value: row.original.joinedAt }),
      ]),
  },
  {
    id: "actions",
    header: "",
    cell: ({ row }) => {
      if (!isOwner.value) return null
      return h(
        UDropdownMenu,
        {
          items: [
            {
              label: "Remove",
              icon: "i-heroicons-trash",
              onSelect: () => confirmRemove(row.original),
            },
          ],
        },
        () =>
          h(UButton, {
            icon: "i-heroicons-ellipsis-horizontal",
            color: "neutral",
            variant: "ghost",
            size: "xs",
            ariaLabel: "Member actions",
          }),
      )
    },
  },
])
</script>

<template>
  <div class="space-y-6">
    <header class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-semibold text-default">
          {{ project?.name ? `${project.name} — Members` : "Members" }}
        </h1>
        <p class="text-sm text-muted mt-1">People with access to this project</p>
      </div>
      <UButton
        v-if="isOwner"
        label="Invite member"
        icon="i-heroicons-plus"
        color="primary"
        @click="inviteOpen = true"
      />
    </header>

    <UCard :ui="{ body: 'p-0' }">
      <UTable
        :data="membersList"
        :columns="columns"
        :loading="pending"
        :ui="{ td: 'text-sm', th: 'text-sm font-medium text-muted uppercase' }"
      />
    </UCard>

    <UCard v-if="isOwner && (invitations ?? []).length > 0" :ui="{ body: 'p-0' }">
      <template #header>
        <div class="px-4 py-3 text-sm font-medium">Pending invitations</div>
      </template>
      <ul class="divide-y divide-default">
        <li
          v-for="inv in invitations"
          :key="inv.id"
          class="flex items-center justify-between px-4 py-3"
        >
          <div>
            <div class="text-sm font-medium">{{ inv.email }}</div>
            <div class="text-sm text-muted">
              Invited as {{ inv.role }} ·
              <RelativeTime :value="inv.expiresAt" prefix="expires" />
            </div>
          </div>
          <div class="flex gap-2">
            <UButton
              size="xs"
              color="neutral"
              variant="ghost"
              label="Resend"
              @click="resendInvite(inv.id)"
            />
            <UButton
              size="xs"
              color="error"
              variant="ghost"
              label="Revoke"
              @click="revokeInvite(inv.id)"
            />
          </div>
        </li>
      </ul>
    </UCard>

    <UModal v-model:open="inviteOpen" :ui="{ content: 'max-w-md' }">
      <template #content>
        <div class="p-6 space-y-4">
          <h3 class="text-lg font-semibold text-default">Invite member</h3>
          <UFormField label="Email" name="email" required>
            <UInput
              v-model="inviteEmail"
              type="email"
              placeholder="person@company.com"
              class="w-full"
            />
          </UFormField>
          <UFormField label="Role" name="role">
            <USelectMenu
              v-model="inviteRole"
              :items="roleOptions"
              value-key="value"
              class="w-full"
            />
          </UFormField>
          <div class="flex justify-end gap-2 pt-2">
            <UButton label="Cancel" color="neutral" variant="ghost" @click="inviteOpen = false" />
            <UButton
              label="Send invite"
              color="primary"
              :loading="inviting"
              :disabled="!inviteEmail"
              @click="sendInvite"
            />
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
