<script setup lang="ts">
import { clampPlayback } from "~/utils/clamp-playback"

// Public share page — no dashboard chrome, no session fetch. Reachable by
// anyone holding the link (see auth.global.ts publicPaths), so this must
// never call the session endpoint or render any authenticated UI.
definePageMeta({ layout: false })

const route = useRoute()
const token = computed(() => String(route.params.token ?? ""))
const requestUrl = useRequestURL()
const blobUrl = computed(() => `/api/shared/${token.value}/blob`)

const { data: meta, error } = await useFetch<{
  kind: string
  mime: string
  sizeBytes: number
  durationMs: number | null
  trimStartMs: number | null
  trimEndMs: number | null
  createdAt: string
  expiresAt: string
}>(() => `/api/shared/${token.value}`)

useHead(() => ({
  title: "Repro — shared recording",
  meta: meta.value
    ? [
        { property: "og:title", content: "Repro screen recording" },
        { property: "og:type", content: "video.other" },
        {
          property: "og:video",
          content: `${requestUrl.origin}/api/shared/${token.value}/blob`,
        },
        { property: "og:video:type", content: meta.value.mime },
        { name: "robots", content: "noindex" },
      ]
    : [{ name: "robots", content: "noindex" }],
}))

const video = ref<HTMLVideoElement | null>(null)
function clampToTrim() {
  const v = video.value
  const m = meta.value
  if (!v || !m) return
  const action = clampPlayback({
    currentTime: v.currentTime,
    duration: v.duration,
    trimStartMs: m.trimStartMs,
    trimEndMs: m.trimEndMs,
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
  <div class="min-h-screen flex flex-col items-center justify-center gap-4 bg-black px-4 py-10">
    <template v-if="meta">
      <video
        ref="video"
        controls
        :src="blobUrl"
        class="w-full max-w-[960px] rounded-lg shadow-xl"
        @loadedmetadata="clampToTrim"
        @timeupdate="clampToTrim"
      />
      <footer class="flex flex-col items-center gap-1 text-center text-sm text-white/50">
        <span
          >Shared via Repro &middot; expires
          {{ new Date(meta.expiresAt).toLocaleDateString() }}</span
        >
        <span v-if="meta.trimStartMs != null || meta.trimEndMs != null">
          Trimmed view — the raw file keeps full length
        </span>
      </footer>
    </template>
    <div v-else-if="error" class="max-w-md text-center text-white">
      <h1 class="text-xl font-semibold">This link isn&rsquo;t available</h1>
      <p class="mt-2 text-sm text-white/60">It may have expired, been revoked, or never existed.</p>
    </div>
  </div>
</template>
