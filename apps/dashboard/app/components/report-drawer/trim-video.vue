<!-- apps/dashboard/app/components/report-drawer/trim-video.vue -->
<script setup lang="ts">
import { clampPlayback } from "~/utils/clamp-playback"

const props = defineProps<{
  src: string
  trimStartMs: number | null
  trimEndMs: number | null
  downloadName?: string
}>()

const video = ref<HTMLVideoElement | null>(null)

// Same adapter shape as app/pages/s/[token].vue — clampPlayback is the pure,
// loop-proof helper; this handler only translates its verdict into DOM
// mutations. Do not reimplement the clamp math inline here.
function clampToTrim() {
  const v = video.value
  if (!v) return
  const action = clampPlayback({
    currentTime: v.currentTime,
    duration: v.duration,
    trimStartMs: props.trimStartMs,
    trimEndMs: props.trimEndMs,
  })
  if (action.type === "seek") {
    v.currentTime = action.to
  } else if (action.type === "pause-and-reset") {
    v.pause()
    v.currentTime = action.to
  }
}
</script>

<template>
  <div>
    <video
      ref="video"
      controls
      preload="metadata"
      :src="src"
      class="w-full rounded-lg"
      @loadedmetadata="clampToTrim"
      @timeupdate="clampToTrim"
    />
    <div class="mt-1 flex items-center justify-between text-xs text-muted">
      <span v-if="trimStartMs != null || trimEndMs != null"
        >Trimmed view · full file via download</span
      >
      <span v-else />
      <a
        :href="src"
        :download="downloadName ?? 'recording'"
        class="font-medium text-primary-600 dark:text-primary-400 hover:underline"
      >
        Download full recording
      </a>
    </div>
  </div>
</template>
