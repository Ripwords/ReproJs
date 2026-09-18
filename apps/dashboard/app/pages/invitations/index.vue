<script setup lang="ts">
import RelativeTime from "~/components/common/relative-time.vue"
import type { ProjectRole } from "@reprojs/shared"

interface PendingInvitation {
  token: string
  projectId: string
  projectName: string
  role: ProjectRole
  inviterName: string | null
  inviterEmail: string | null
  invitedAt: string
  expiresAt: string
}

useHead({ title: "Pending invitations" })

const { data, pending, refresh } = await useApi<PendingInvitation[]>("/api/invitations", {
  default: () => [],
})

const invites = computed(() => data.value ?? [])

function inviterLabel(inv: PendingInvitation): string {
  return inv.inviterName || inv.inviterEmail || "Someone"
}
</script>

<template>
  <div class="max-w-2xl mx-auto p-6 mt-8">
    <div class="mb-6">
      <h1 class="text-xl font-semibold">Pending invitations</h1>
      <p class="text-sm text-muted mt-1">
        Projects you've been invited to join. Invitations expire automatically after a while.
      </p>
    </div>

    <UCard v-if="pending">
      <p class="text-sm text-muted">Loading…</p>
    </UCard>

    <UCard v-else-if="invites.length === 0">
      <div class="text-center py-6">
        <p class="font-medium">No pending invitations</p>
        <p class="text-sm text-muted mt-1">
          You'll see any outstanding invites from project owners here.
        </p>
      </div>
    </UCard>

    <ul v-else class="flex flex-col gap-3">
      <li
        v-for="inv in invites"
        :key="inv.token"
        class="rounded border border-default bg-default p-4 flex items-start justify-between gap-4"
      >
        <div class="min-w-0">
          <div class="font-medium truncate">{{ inv.projectName }}</div>
          <div class="text-sm text-muted mt-0.5">
            {{ inviterLabel(inv) }} invited you as
            <strong>{{ inv.role }}</strong>
            · <RelativeTime :value="inv.expiresAt" prefix="expires" />
          </div>
        </div>
        <div class="flex gap-2 shrink-0">
          <UButton
            :to="`/invitations/${inv.token}`"
            label="Review"
            color="primary"
            size="sm"
            @click="refresh"
          />
        </div>
      </li>
    </ul>
  </div>
</template>
