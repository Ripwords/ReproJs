<!-- report-drawer/pickers/milestone-picker.vue
     Single-select milestone picker backed by the linked repo's open milestones. -->
<script setup lang="ts">
import type { GithubMilestoneListDTO } from "@reprojs/shared"

const props = defineProps<{
  projectId: string
  modelValue: { number: number; title: string } | null
  disabled?: boolean
}>()
const emit = defineEmits<{
  "update:modelValue": [value: { number: number; title: string } | null]
}>()

const { data, pending } = useFetch<GithubMilestoneListDTO>(
  () => `/api/projects/${props.projectId}/integrations/github/milestones?state=open`,
  { default: () => ({ items: [] }) },
)

const options = computed(() => {
  const opts: Array<{ value: number | null; label: string }> = [
    { value: null, label: "No milestone" },
  ]
  for (const m of data.value?.items ?? []) {
    opts.push({ value: m.number, label: m.title })
  }
  // Inject the current milestone if it's closed (not in open list)
  if (props.modelValue && !opts.find((o) => o.value === props.modelValue!.number)) {
    opts.push({ value: props.modelValue.number, label: `${props.modelValue.title} (closed)` })
  }
  return opts
})

const current = computed({
  get: () => props.modelValue?.number ?? null,
  set: (n: number | null) => {
    if (n === null) {
      emit("update:modelValue", null)
      return
    }
    const item = data.value?.items.find((m) => m.number === n)
    emit("update:modelValue", item ? { number: item.number, title: item.title } : null)
  },
})
</script>

<template>
  <USelect
    v-model="current"
    :items="options"
    value-key="value"
    label-key="label"
    :loading="pending"
    :disabled="disabled"
  />
</template>
