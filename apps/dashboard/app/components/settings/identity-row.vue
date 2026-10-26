<script setup lang="ts">
type IdentityItem = {
  provider: "github"
  externalHandle: string
  externalAvatarUrl: string | null
  externalName: string | null
  linkedAt: string
}

const props = defineProps<{
  provider: "github"
  label: string
  icon: string
  item: IdentityItem | null
  connecting: boolean
  disconnecting?: boolean
}>()
const emit = defineEmits<{
  connect: []
  disconnect: []
}>()
</script>

<template>
  <div class="flex items-center justify-between border rounded-md px-4 py-3">
    <div class="flex items-center gap-3">
      <UIcon :name="icon" class="size-6" />
      <div>
        <div class="font-medium">{{ label }}</div>
        <div v-if="item" class="text-sm text-muted">
          Connected as <span class="font-mono">@{{ item.externalHandle }}</span>
        </div>
        <div v-else class="text-sm text-muted">Not connected</div>
      </div>
    </div>
    <div>
      <UButton v-if="!item" :loading="connecting" @click="emit('connect')">Connect</UButton>
      <UButton
        v-else
        variant="ghost"
        color="error"
        :loading="disconnecting"
        @click="emit('disconnect')"
      >
        Disconnect
      </UButton>
    </div>
  </div>
</template>
