<script setup lang="ts">
import PageHeader from "~/components/common/page-header.vue"
import SettingsIdentityRow from "~/components/settings/identity-row.vue"

useHead({ title: "Linked accounts" })

type IdentityItem = {
  provider: "github"
  externalHandle: string
  externalAvatarUrl: string | null
  externalName: string | null
  linkedAt: string
}

const { data, refresh } = await useApi<{ items: IdentityItem[] }>("/api/me/identities", {
  default: () => ({ items: [] }),
})

const github = computed(() => data.value?.items.find((i) => i.provider === "github") ?? null)

const route = useRoute()
const toast = useToast()

onMounted(() => {
  if (route.query.linked === "github") {
    toast.add({ title: "GitHub account linked", color: "success" })
  }
  if (typeof route.query.error === "string") {
    toast.add({ title: "Link failed", description: route.query.error, color: "error" })
  }
})

const connecting = ref(false)
async function connectGithub() {
  connecting.value = true
  try {
    const res = await $fetch<{ redirectUrl: string }>("/api/me/identities/github/start", {
      method: "POST",
      credentials: "include",
    })
    window.location.href = res.redirectUrl
  } catch {
    toast.add({ title: "Could not start link flow", color: "error" })
    connecting.value = false
  }
}

async function disconnectGithub() {
  await $fetch("/api/me/identities/github", { method: "DELETE", credentials: "include" })
  await refresh()
  toast.add({ title: "GitHub account disconnected" })
}
</script>

<template>
  <div class="space-y-6 max-w-3xl">
    <PageHeader
      eyebrow="Account"
      title="Linked accounts"
      description="Connect your GitHub account so assignments, labels, and comments stay in sync both ways."
    />
    <div class="space-y-3">
      <SettingsIdentityRow
        provider="github"
        label="GitHub"
        icon="i-simple-icons-github"
        :item="github"
        :connecting="connecting"
        @connect="connectGithub"
        @disconnect="disconnectGithub"
      />
    </div>
  </div>
</template>
