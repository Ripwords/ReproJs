<!-- apps/dashboard/app/components/report-drawer/replay-tab.vue -->
<script setup lang="ts">
import { computed, ref, onMounted, onBeforeUnmount, nextTick, watch } from "vue"
// Side-effect import injects rrweb-player's stylesheet at build time. A
// dynamic `await import("rrweb-player/dist/style.css")` does NOT reliably
// inject the CSS in Vite/Nuxt — the module resolves but the bundler may
// treat it as an asset URL and never insert a <style> tag, leaving the
// player chrome (controls, zoom buttons) invisible until clicked.
// oxlint-disable-next-line eslint-plugin-import/no-unassigned-import
import "rrweb-player/dist/style.css"

const props = defineProps<{
  projectId: string
  reportId: string
  hasReplay: boolean
}>()

const playerHost = ref<HTMLDivElement | null>(null)
const isFullscreen = ref(false)
let player: unknown = null

// The player's built-in fullscreen button calls `.rr-player.requestFullscreen()`.
// That request can silently reject in our embed context (certain ancestor
// stacking contexts / Nuxt UI layouts), and rrweb-player swallows the
// rejection — leaving the user clicking a button that does nothing. Our own
// toggle (a) flips a CSS class that pins the card to `fixed inset-0` so the
// player fills the viewport no matter what the DOM says, and (b) also tries
// `document.documentElement.requestFullscreen()` so the browser chrome hides
// too. The native call targets <html> instead of the player, which bypasses
// any containing-block issues; if it rejects anyway, the CSS fallback still
// gives the user a usable expanded view.
async function toggleFullscreen() {
  const next = !isFullscreen.value
  isFullscreen.value = next
  if (next) {
    try {
      await document.documentElement.requestFullscreen()
    } catch {
      /* CSS fallback handles it */
    }
  } else if (document.fullscreenElement) {
    try {
      await document.exitFullscreen()
    } catch {
      /* already exited */
    }
  }
  // rrweb-player draws into a fixed-aspect iframe scaled to the host
  // element. After a size change we have to ask it to re-measure, or the
  // iframe stays at its pre-toggle size and goes letterboxed.
  await nextTick()
  const p = player as { triggerResize?: () => void } | null
  p?.triggerResize?.()
}

async function onFullscreenChange() {
  // Sync when the user hits ESC — the browser exits native fullscreen but
  // our `isFullscreen` ref is otherwise unaware. Without this, the CSS
  // fullscreen sticks around after ESC.
  if (!document.fullscreenElement && isFullscreen.value) {
    isFullscreen.value = false
    await nextTick()
    const p = player as { triggerResize?: () => void } | null
    p?.triggerResize?.()
  }
}

function onKeydown(e: KeyboardEvent) {
  // Handle ESC when we entered via CSS-only fullscreen (native request
  // rejected) — `fullscreenchange` won't fire in that case.
  if (e.key === "Escape" && isFullscreen.value && !document.fullscreenElement) {
    void toggleFullscreen()
  }
}

type ReplayEvent = { type: number; data: unknown; timestamp: number }

// The replay is a gzipped rrweb event log that can run to megabytes, so it is
// fetched lazily on the client only (never during SSR or into the payload)
// and decoded inside the handler so the cache holds parsed events.
const { data: events, error: fetchError } = useLazyAsyncData(
  `replay-${props.projectId}-${props.reportId}`,
  async (): Promise<ReplayEvent[]> => {
    const gzipped = await $fetch<ArrayBuffer>(
      `/api/projects/${props.projectId}/reports/${props.reportId}/attachment?kind=replay`,
      { credentials: "include", responseType: "arrayBuffer" },
    )
    const stream = new Blob([gzipped]).stream().pipeThrough(new DecompressionStream("gzip"))
    return JSON.parse(await new Response(stream).text()) as ReplayEvent[]
  },
  { server: false, immediate: props.hasReplay },
)

const playerError = ref<string | null>(null)
const playerReady = ref(false)

const status = computed<"loading" | "ready" | "error" | "missing">(() => {
  if (!props.hasReplay || fetchError.value?.statusCode === 404) return "missing"
  if (fetchError.value || playerError.value) return "error"
  if (playerReady.value) return "ready"
  return "loading"
})
const errorMessage = computed(
  () => playerError.value ?? describeApiError(fetchError.value, "Could not load the replay."),
)

async function mountPlayer(list: ReplayEvent[], host: HTMLDivElement) {
  try {
    const { default: Player } = await import("rrweb-player")
    player = new Player({
      target: host,
      props: { events: list, autoPlay: false, showController: true },
    })
    playerReady.value = true
  } catch (err) {
    playerError.value = describeApiError(err, "The replay player failed to start.")
  }
}

// Mount once both the decoded events and the host element exist.
watch(
  [events, playerHost],
  ([list, host]) => {
    if (player || !list || !host) return
    void mountPlayer(list, host)
  },
  { immediate: true },
)

onMounted(() => {
  document.addEventListener("fullscreenchange", onFullscreenChange)
  document.addEventListener("keydown", onKeydown)
})

onBeforeUnmount(() => {
  document.removeEventListener("fullscreenchange", onFullscreenChange)
  document.removeEventListener("keydown", onKeydown)
  if (isFullscreen.value && document.fullscreenElement) {
    void document.exitFullscreen().catch(() => {})
  }
  if (player && typeof (player as { $destroy?: () => void }).$destroy === "function") {
    ;(player as { $destroy: () => void }).$destroy()
  }
})
</script>

<template>
  <div :class="isFullscreen ? 'p-0' : 'p-5'">
    <UCard
      :ui="{ body: 'p-0 overflow-hidden' }"
      :class="isFullscreen ? 'replay-card--fullscreen' : ''"
    >
      <div
        v-if="status === 'ready'"
        class="flex items-center justify-end gap-2 px-3 py-2 border-b border-default"
      >
        <UButton
          size="xs"
          variant="ghost"
          :icon="isFullscreen ? 'i-lucide-minimize-2' : 'i-lucide-maximize-2'"
          :label="isFullscreen ? 'Exit fullscreen' : 'Fullscreen'"
          @click="toggleFullscreen"
        />
      </div>
      <div v-if="status === 'missing'" class="text-sm text-muted p-8 text-center">
        No replay captured for this report.
      </div>
      <div v-else-if="status === 'loading'" class="text-sm text-muted p-8 text-center">
        Loading replay…
      </div>
      <div v-else-if="status === 'error'" class="text-sm text-error p-8 text-center">
        Replay unavailable. {{ errorMessage }}
      </div>
      <div
        ref="playerHost"
        class="replay-host w-full"
        :class="isFullscreen ? 'replay-host--fullscreen' : 'min-h-[400px]'"
      />
    </UCard>
  </div>
</template>

<style scoped>
/*
 * rrweb-player ships Svelte-scoped CSS hardcoded to a blue-purple accent
 * (rgb(73, 80, 246)) and a near-white chrome. Remap both onto the app's
 * flame primary + mist neutrals so the controller matches the rest of
 * the dashboard. Svelte's doubled-class selectors give the vendor styles
 * (0,3,0) specificity, so every override uses !important to win without
 * fighting the hash-class chain.
 */
.replay-host :deep(.rr-player) {
  background: var(--ui-bg) !important;
  box-shadow: var(--shadow-card) !important;
  border-radius: var(--ui-radius, 6px) !important;
}

.replay-host :deep(.rr-controller) {
  background: var(--ui-bg) !important;
  border-top: 1px solid var(--ui-border) !important;
}

.replay-host :deep(.rr-timeline__time) {
  color: var(--ui-text) !important;
  font-family: var(--font-mono) !important;
  font-size: 0.8125rem !important;
}

.replay-host :deep(.rr-progress) {
  background: var(--ui-bg-muted) !important;
  border-top-color: var(--ui-bg) !important;
  border-bottom-color: var(--ui-bg) !important;
}

.replay-host :deep(.rr-progress__step) {
  background: color-mix(in oklch, var(--ui-primary) 28%, transparent) !important;
}

.replay-host :deep(.rr-progress__handler) {
  background: var(--ui-primary) !important;
  box-shadow: 0 0 0 3px color-mix(in oklch, var(--ui-primary) 22%, transparent) !important;
}

.replay-host :deep(.rr-controller__btns button) {
  color: var(--ui-text-toned) !important;
}
.replay-host :deep(.rr-controller__btns button:hover) {
  color: var(--ui-text) !important;
}
.replay-host :deep(.rr-controller__btns button:active) {
  background: var(--ui-bg-accented) !important;
}
.replay-host :deep(.rr-controller__btns button.active) {
  background: var(--ui-primary) !important;
  color: var(--ui-bg) !important;
}

/*
 * Icon SVGs inside the controller (play/pause, fullscreen) ship with no
 * `fill` attribute, so they default to black and disappear on the dark
 * surface. Remap `fill` to `currentColor` so they inherit the button's
 * text color (set above). Applies to any inline <svg> the player injects.
 */
.replay-host :deep(.rr-controller svg),
.replay-host :deep(.rr-controller svg path) {
  fill: currentColor !important;
}

/*
 * Hide rrweb-player's "skip inactive" toggle. The feature auto-fast-
 * forwards through gaps > `inactivePeriodThreshold` (default 10s) between
 * user-interaction events. For a rolling 30-second bug-report buffer
 * where MouseMove events fire every 500ms whenever the cursor moves,
 * that threshold essentially never triggers — the toggle is functionally
 * a no-op and only confuses users who try it and see nothing happen.
 * The feature makes sense for rrweb's full-session replay use case, not
 * ours.
 */
.replay-host :deep(.switch) {
  display: none !important;
}

/* Live-cursor dot inside the replayer iframe overlay */
.replay-host :deep(.replayer-mouse::after) {
  background: var(--ui-primary) !important;
}
.replay-host :deep(.replayer-mouse.touch-device.touch-active) {
  border-color: var(--ui-primary) !important;
}

/*
 * Fullscreen — CSS-driven. Pinning the card to `fixed inset-0` fills the
 * viewport regardless of whether the native Fullscreen API accepts the
 * request on the player element. We also try `document.documentElement
 * .requestFullscreen()` from JS so the browser chrome hides when permitted,
 * but this CSS layer is the one that guarantees the expanded view.
 */
.replay-card--fullscreen {
  position: fixed !important;
  inset: 0 !important;
  margin: 0 !important;
  border-radius: 0 !important;
  z-index: 60;
  display: flex;
  flex-direction: column;
}
.replay-host--fullscreen {
  flex: 1 1 auto;
  min-height: 0;
  /* Explicit height so rrweb-player's `triggerResize` picks up a real size
     and rescales its inner iframe; without a computed height the player
     keeps its pre-toggle dimensions. */
  height: 100%;
}

/*
 * Hide rrweb-player's built-in fullscreen button. It calls
 * `.rr-player.requestFullscreen()` which can silently reject in the
 * dashboard's DOM context, leaving the user clicking a dead button. The
 * custom toggle at the top of the card supersedes it. The native button
 * renders as the last child of `.rr-controller__btns` (play/pause,
 * skip-inactive, speed, fullscreen); if rrweb-player reorders it this
 * selector would need updating.
 */
.replay-host :deep(.rr-controller__btns > button:last-of-type) {
  display: none !important;
}
</style>
