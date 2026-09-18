<script setup lang="ts">
import RelativeTime from "~/components/common/relative-time.vue"
import { h, resolveComponent } from "vue"
import type { TableColumn } from "@nuxt/ui"
import type { InstallRole, UserDTO, UserStatus } from "@reprojs/shared"

definePageMeta({ middleware: "admin-only" })
useHead({ title: "Users" })

const UAvatar = resolveComponent("UAvatar")
const UBadge = resolveComponent("UBadge")
const UButton = resolveComponent("UButton")
const UDropdownMenu = resolveComponent("UDropdownMenu")
const USelectMenu = resolveComponent("USelectMenu")

const toast = useToast()
const { confirm } = useConfirm()

const {
  data: users,
  pending,
  refresh,
} = await useApi<UserDTO[]>("/api/users", {
  default: () => [],
})

const usersList = computed<UserDTO[]>(() => users.value ?? [])

const roleOptions = [
  { label: "Admin", value: "admin" },
  { label: "Member", value: "member" },
] as const

const inviteOpen = ref(false)
const inviteEmail = ref("")
const inviteRole = ref<InstallRole>("member")
const inviting = ref(false)

async function sendInvite() {
  if (!inviteEmail.value) return
  inviting.value = true
  try {
    await $fetch("/api/users", {
      method: "POST",
      credentials: "include",
      body: { email: inviteEmail.value, role: inviteRole.value },
    })
    inviteOpen.value = false
    inviteEmail.value = ""
    inviteRole.value = "member"
    toast.add({ title: "Invite sent", color: "success", icon: "i-heroicons-check-circle" })
    await refresh()
  } catch (err) {
    toast.add({
      title: "Could not send invite",
      description: err instanceof Error ? err.message : undefined,
      color: "error",
      icon: "i-heroicons-exclamation-triangle",
    })
  } finally {
    inviting.value = false
  }
}

async function updateRole(userId: string, next: InstallRole) {
  try {
    await $fetch(`/api/users/${userId}`, {
      method: "PATCH",
      credentials: "include",
      body: { role: next },
    })
    toast.add({ title: "Role updated", color: "success", icon: "i-heroicons-check-circle" })
    await refresh()
  } catch (err) {
    toast.add({
      title: "Could not update role",
      description: err instanceof Error ? err.message : undefined,
      color: "error",
      icon: "i-heroicons-exclamation-triangle",
    })
  }
}

async function setStatus(userId: string, status: UserStatus) {
  try {
    await $fetch(`/api/users/${userId}`, {
      method: "PATCH",
      credentials: "include",
      body: { status },
    })
    toast.add({
      title: status === "disabled" ? "User disabled" : "User reactivated",
      color: "success",
      icon: "i-heroicons-check-circle",
    })
    await refresh()
  } catch (err) {
    toast.add({
      title: status === "disabled" ? "Could not disable user" : "Could not reactivate user",
      description: err instanceof Error ? err.message : undefined,
      color: "error",
      icon: "i-heroicons-exclamation-triangle",
    })
  }
}

async function confirmDisable(u: UserDTO) {
  const ok = await confirm({
    title: "Disable user?",
    description: `${u.email} will lose access to this install.`,
    confirmLabel: "Disable user",
    confirmColor: "error",
    icon: "i-heroicons-no-symbol",
  })
  if (!ok) return
  void setStatus(u.id, "disabled")
}

function reactivate(u: UserDTO) {
  void setStatus(u.id, "active")
}

function statusColor(status: UserStatus): "success" | "neutral" | "warning" {
  if (status === "active") return "success"
  if (status === "disabled") return "warning"
  return "neutral"
}

function initials(name: string | null, email: string): string {
  const base = name?.trim() || email
  return base.slice(0, 2).toUpperCase()
}

const columns = computed<TableColumn<UserDTO>[]>(() => [
  {
    accessorKey: "email",
    header: "User",
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
    cell: ({ row }) =>
      h(USelectMenu, {
        modelValue: roleOptions.find((o) => o.value === row.original.role),
        items: roleOptions,
        size: "xs",
        class: "w-28",
        "onUpdate:modelValue": (v: { label: string; value: InstallRole }) => {
          if (v?.value && v.value !== row.original.role) {
            void updateRole(row.original.id, v.value)
          }
        },
      }),
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) =>
      h(
        UBadge,
        {
          color: statusColor(row.original.status),
          variant: "subtle",
          size: "sm",
        },
        () => row.original.status,
      ),
  },
  {
    accessorKey: "createdAt",
    header: "Joined",
    cell: ({ row }) =>
      h("span", { class: "text-sm text-muted" }, [
        h(RelativeTime, { value: row.original.createdAt }),
      ]),
  },
  {
    id: "actions",
    header: "",
    cell: ({ row }) => {
      const items =
        row.original.status === "disabled"
          ? [
              {
                label: "Reactivate",
                icon: "i-heroicons-arrow-path",
                onSelect: () => reactivate(row.original),
              },
            ]
          : [
              {
                label: "Disable",
                icon: "i-heroicons-no-symbol",
                onSelect: () => confirmDisable(row.original),
              },
            ]
      return h(UDropdownMenu, { items }, () =>
        h(UButton, {
          icon: "i-heroicons-ellipsis-horizontal",
          color: "neutral",
          variant: "ghost",
          size: "xs",
          ariaLabel: "User actions",
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
        <h1 class="text-2xl font-semibold text-default">Users</h1>
        <p class="text-sm text-muted mt-1">Everyone with access to this install.</p>
      </div>
      <UButton
        label="Invite user"
        icon="i-heroicons-plus"
        color="primary"
        @click="inviteOpen = true"
      />
    </header>

    <UCard :ui="{ body: 'p-0' }">
      <UTable
        :data="usersList"
        :columns="columns"
        :loading="pending"
        :ui="{ td: 'text-sm', th: 'text-sm font-medium text-muted uppercase' }"
      />
    </UCard>

    <UModal v-model:open="inviteOpen" :ui="{ content: 'max-w-md' }">
      <template #content>
        <div class="p-6 space-y-4">
          <h3 class="text-lg font-semibold text-default">Invite user</h3>
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
