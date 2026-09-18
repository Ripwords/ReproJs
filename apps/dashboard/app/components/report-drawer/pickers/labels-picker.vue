<!-- report-drawer/pickers/labels-picker.vue
     GitHub-style label selector. The selected labels are the focal display —
     rendered as coloured pill badges below a minimal, unobtrusive trigger.
     Clicking the trigger opens the full multi-select dropdown with color
     swatches; clicking a badge's × removes that label inline.

     Custom labels: typing a name that doesn't match any existing repo label
     surfaces a "Create '<name>'" option at the bottom of the dropdown. On
     select we POST /labels to create it in the linked GitHub repo, refetch
     the list, and append it to the current selection. -->
<script setup lang="ts">
type RepoLabel = { name: string; color: string; description: string | null }

const props = defineProps<{
  projectId: string
  modelValue: string[]
  disabled?: boolean
  /** Offer "Create '<name>'" for unknown labels. The POST is developer+, so
   *  managers can pick existing labels but not add new ones to the repo. */
  canCreate: boolean
}>()
const emit = defineEmits<{
  "update:modelValue": [value: string[]]
}>()

const toast = useToast()
const creating = ref(false)

const { data, pending, error, refresh } = useFetch<{ items: RepoLabel[] }>(
  () => `/api/projects/${props.projectId}/integrations/github/labels`,
  { default: () => ({ items: [] }) },
)

// Filter out priority:* managed labels — those are driven by the priority picker.
const repoLabels = computed(() =>
  (data.value?.items ?? []).filter((l) => !l.name.startsWith("priority:")),
)

const current = computed({
  get: () => props.modelValue,
  set: (v: string[]) => emit("update:modelValue", v),
})

// Lookup so selected chips render immediately even before the dropdown data
// fully loads (for reports restored from a cached payload, etc.).
const colorByName = computed(() => {
  const m = new Map<string, string>()
  for (const l of repoLabels.value) m.set(l.name, l.color)
  return m
})

const selectedWithColor = computed(() =>
  current.value
    .filter((name) => !name.startsWith("priority:") && colorByName.value.has(name))
    .map((name) => ({ name, color: colorByName.value.get(name)! })),
)

const orphanLabels = computed(() => {
  const known = new Set(repoLabels.value.map((l) => l.name))
  return current.value.filter((name) => !known.has(name) && !name.startsWith("priority:"))
})

function removeLabel(name: string) {
  if (props.disabled) return
  current.value = current.value.filter((n) => n !== name)
}

// Create a new label in the linked repo, refetch the list so the pill
// renders with its server-assigned colour, then append to the current
// selection. Any 4xx surfaces as a toast so the user knows what broke
// (conflicts → "already exists", 400 → validation).
async function createLabel(name: string) {
  if (props.disabled || !props.canCreate || creating.value) return
  const trimmed = name.trim()
  if (!trimmed) return
  if (current.value.includes(trimmed)) return

  creating.value = true
  try {
    await $fetch(`/api/projects/${props.projectId}/integrations/github/labels`, {
      method: "POST",
      body: { name: trimmed },
      credentials: "include",
    })
    await refresh()
    current.value = [...current.value, trimmed]
    toast.add({
      title: `Created label "${trimmed}"`,
      color: "success",
      icon: "i-heroicons-check-circle",
    })
  } catch (err) {
    toast.add({
      title: "Could not create label",
      description: err instanceof Error ? err.message : undefined,
      color: "error",
      icon: "i-heroicons-exclamation-triangle",
    })
  } finally {
    creating.value = false
  }
}

// Pick readable text color (white or near-black) against the hex background.
// Rec. 709 luminance weighting matches GitHub's own label-readability heuristic.
function textColorForBg(hex: string): string {
  if (hex.length !== 6) return "#ffffff"
  const r = parseInt(hex.slice(0, 2), 16)
  const g = parseInt(hex.slice(2, 4), 16)
  const b = parseInt(hex.slice(4, 6), 16)
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
  return luminance > 0.6 ? "#1f2328" : "#ffffff"
}
</script>

<template>
  <div class="space-y-2">
    <USelectMenu
      v-model="current"
      :items="repoLabels"
      value-key="name"
      label-key="name"
      multiple
      :loading="pending || creating"
      :disabled="disabled"
      size="sm"
      variant="outline"
      class="w-full"
      :create-item="canCreate ? { position: 'bottom', when: 'empty' } : false"
      :ui="{
        base: 'justify-between',
        label: 'text-muted font-normal',
      }"
      @create="createLabel"
    >
      <template #default>
        <span class="inline-flex items-center gap-1.5 text-muted">
          <UIcon name="i-lucide-tag" class="size-3.5" />
          <span>
            {{
              selectedWithColor.length > 0
                ? `Manage ${selectedWithColor.length + orphanLabels.length} label${selectedWithColor.length + orphanLabels.length === 1 ? "" : "s"}`
                : "Add labels"
            }}
          </span>
        </span>
      </template>
      <template #option="{ option }">
        <span
          class="inline-block size-2.5 rounded-full mr-2 shrink-0 ring-1 ring-inset ring-black/10"
          :style="`background: #${option.color}`"
        />
        <span class="truncate">{{ option.name }}</span>
        <span v-if="option.description" class="text-sm text-muted ml-2 truncate">
          {{ option.description }}
        </span>
      </template>
    </USelectMenu>

    <!-- Selected labels: GitHub-authentic pills, readable regardless of hue.
         The pill itself is a passive span; only the × button removes. -->
    <div v-if="selectedWithColor.length || orphanLabels.length" class="flex flex-wrap gap-1.5">
      <span
        v-for="label in selectedWithColor"
        :key="label.name"
        class="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full text-sm font-semibold leading-snug tracking-tight ring-1 ring-inset ring-black/10"
        :style="{
          backgroundColor: `#${label.color}`,
          color: textColorForBg(label.color),
        }"
      >
        <span>{{ label.name }}</span>
        <button
          v-if="!disabled"
          type="button"
          class="inline-flex items-center justify-center size-4 rounded-full opacity-60 hover:opacity-100 hover:bg-black/10 transition-opacity cursor-pointer"
          :aria-label="`Remove label ${label.name}`"
          :title="`Remove ${label.name}`"
          @click="removeLabel(label.name)"
        >
          <UIcon name="i-lucide-x" class="size-3 shrink-0" />
        </button>
      </span>

      <!-- Orphan labels: out-of-band, needs attention. Distinct dashed treatment
           so they read as "pending reconciliation" rather than a real label. -->
      <span
        v-for="name in orphanLabels"
        :key="`orphan:${name}`"
        class="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full text-sm font-medium leading-snug tracking-tight border border-dashed border-warning-500 text-warning-500 bg-warning-500/5"
        :title="`${name} is not present in the linked repository's label set`"
      >
        <UIcon name="i-lucide-triangle-alert" class="size-3 shrink-0" />
        <span>{{ name }}</span>
        <button
          v-if="!disabled"
          type="button"
          class="inline-flex items-center justify-center size-4 rounded-full opacity-60 hover:opacity-100 hover:bg-warning-500/15 transition-opacity cursor-pointer"
          :aria-label="`Remove orphan label ${name}`"
          :title="`Remove ${name}`"
          @click="removeLabel(name)"
        >
          <UIcon name="i-lucide-x" class="size-3 shrink-0" />
        </button>
      </span>
    </div>

    <p v-if="error" class="text-sm text-muted">
      Couldn't reach GitHub. Your changes will still save.
    </p>
  </div>
</template>
