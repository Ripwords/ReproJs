<!-- Relative time as the visible text, full date and time in a tooltip.
     The tooltip content only renders on hover (client-side), so it always
     uses the viewer's locale and time zone rather than the server's. The
     visible text is computed on the server and again on hydration, and can
     differ by a minute; data-allow-mismatch keeps that out of the console. -->
<script setup lang="ts">
import { formatAbsolute, formatRelative } from "~/utils/date-format"

const props = defineProps<{
  value: string | Date | null | undefined
  compact?: boolean
  /** Text before the relative time, e.g. "Expires" → "Expires in 6d". */
  prefix?: string
}>()

const iso = computed(() => {
  if (!props.value) return undefined
  const d = props.value instanceof Date ? props.value : new Date(props.value)
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString()
})
const relative = computed(() => formatRelative(props.value, { compact: props.compact }))
const text = computed(() => (props.prefix ? `${props.prefix} ${relative.value}` : relative.value))
</script>

<template>
  <UTooltip v-if="iso" :text="formatAbsolute(value)">
    <time :datetime="iso" class="tabular-nums" data-allow-mismatch="text">{{ text }}</time>
  </UTooltip>
  <span v-else>—</span>
</template>
