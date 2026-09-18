<!-- apps/dashboard/app/components/report-drawer/overview-tab.vue
     Overview pane for a report. The signature element is the
     orange-accented section header — a 1px-stroked card with a tinted
     `bg-primary/8` header strip and `text-primary` label.

     Layout:
       Top row:    Screenshot (col-span-7) | Description + Report details (col-span-5)
       Bottom row: Conversation (chat-style comments, full width)

     Diagnostic content (Session env / System info / Raw context) lives
     in the dedicated System and Raw tabs — the overview is for the
     "what / who / when" + the conversation around the bug. -->
<script setup lang="ts">
import RelativeTime from "~/components/common/relative-time.vue"
import type { ReportDetailDTO } from "@reprojs/shared"
import { safeHref } from "~/composables/use-safe-href"
import { useMarkdown } from "~/composables/use-markdown"
import {
  priorityColor,
  priorityLabel,
  statusColor,
  statusLabel,
} from "~/composables/use-report-format"
import CommentsTab from "./comments-tab.vue"

const props = defineProps<{ projectId: string; report: ReportDetailDTO; canComment: boolean }>()
const emit = defineEmits<{
  "select-tab": [tab: "console" | "network" | "replay" | "attachments"]
}>()

const userFileCount = computed(
  () => (props.report.attachments ?? []).filter((a) => a.kind === "user-file").length,
)

const ctx = computed(() => props.report.context)

// Lightbox state — opened by the fullscreen button overlaying the
// screenshot card. Native Fullscreen API behaviour (Esc to close) is
// emulated here with a simple modal so it works inside Nuxt UI's drawer
// stacking context too.
//
// Esc handling: the parent report page registers a window-level keydown
// that navigates back to the inbox on Escape. We need to intercept Esc
// FIRST when the lightbox is open and stop it from reaching that handler.
// Using `capture: true` on document fires this listener during the capture
// phase — before the event reaches window's bubble-phase listener — so a
// single `stopPropagation` here keeps the user on the report.
const lightboxOpen = ref(false)
function openLightbox() {
  lightboxOpen.value = true
}
function closeLightbox() {
  lightboxOpen.value = false
}
function onLightboxKey(e: KeyboardEvent) {
  if (e.key !== "Escape") return
  e.preventDefault()
  e.stopPropagation()
  e.stopImmediatePropagation()
  closeLightbox()
}
watch(lightboxOpen, (open) => {
  if (import.meta.server) return
  if (open) {
    document.addEventListener("keydown", onLightboxKey, { capture: true })
    document.body.style.overflow = "hidden"
  } else {
    document.removeEventListener("keydown", onLightboxKey, { capture: true })
    document.body.style.overflow = ""
  }
})
onUnmounted(() => {
  if (import.meta.server) return
  document.removeEventListener("keydown", onLightboxKey, { capture: true })
  document.body.style.overflow = ""
})

const { renderMarkdown } = useMarkdown()
const descriptionHtml = computed(() =>
  props.report.description
    ? renderMarkdown(props.report.description, { rewriteImagesFor: { projectId: props.projectId } })
    : "",
)
</script>

<template>
  <div class="p-5 space-y-4">
    <!-- HERO: screenshot (left) + description / report-details rail (right) -->
    <div class="grid grid-cols-1 lg:grid-cols-12 gap-4">
      <!-- Screenshot — borderless dark canvas; the image floats in a
           letterboxed frame so portrait + landscape both look intentional.
           Fullscreen toggle in the corner opens a lightbox so reviewers can
           inspect detail without leaving the page. -->
      <div
        v-if="report.thumbnailUrl"
        class="lg:col-span-7 group relative overflow-hidden rounded-xl ring-1 ring-default bg-elevated"
      >
        <button
          type="button"
          aria-label="View screenshot full screen"
          class="flex items-center justify-center bg-neutral-900 dark:bg-neutral-950 max-h-[60vh] p-6 w-full cursor-zoom-in"
          @click="openLightbox"
        >
          <img
            :src="report.thumbnailUrl"
            alt="Report screenshot"
            class="max-h-[52vh] max-w-full object-contain block rounded-lg"
          />
        </button>
        <button
          type="button"
          aria-label="View screenshot full screen"
          title="Fullscreen (click image)"
          class="absolute top-3 right-3 inline-flex items-center justify-center size-9 rounded-lg bg-neutral-950/70 text-white ring-1 ring-white/10 backdrop-blur-sm opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:bg-neutral-950/90 transition-opacity"
          @click="openLightbox"
        >
          <UIcon name="i-heroicons-arrows-pointing-out" class="size-4" />
        </button>
      </div>
      <div v-else class="lg:col-span-7"></div>

      <!-- Right rail: stacked description + report details -->
      <div class="lg:col-span-5 flex flex-col gap-4">
        <!-- Description always renders so the right rail keeps its visual
             rhythm even when the SDK caller submitted no body — the
             empty-state copy makes the absence intentional rather than
             reading as a layout bug. -->
        <section class="overflow-hidden rounded-xl ring-1 ring-default bg-default">
          <header class="px-5 py-3 bg-primary/[0.08] border-b border-default">
            <h3 class="text-sm font-medium text-primary tracking-tight">Description</h3>
          </header>
          <div
            v-if="report.description"
            class="prose prose-sm dark:prose-invert max-w-none text-default text-sm leading-relaxed px-5 py-4"
            v-html="descriptionHtml"
          />
          <p v-else class="px-5 py-4 text-sm text-muted italic">
            No description provided by the reporter.
          </p>
        </section>

        <section class="overflow-hidden rounded-xl ring-1 ring-default bg-default">
          <header class="px-5 py-3 bg-primary/[0.08] border-b border-default">
            <h3 class="text-sm font-medium text-primary tracking-tight">Report details</h3>
          </header>
          <dl class="px-5 py-4 text-sm space-y-3">
            <div class="flex items-start gap-3">
              <dt class="text-muted w-24 shrink-0">Reporter</dt>
              <dd class="text-default min-w-0 flex-1 truncate">
                {{ report.reporterEmail ?? "anonymous" }}
              </dd>
            </div>
            <div class="flex items-start gap-3">
              <dt class="text-muted w-24 shrink-0">
                {{ ctx?.source === "expo" ? "Route" : "Page" }}
              </dt>
              <dd class="min-w-0 flex-1">
                <template v-if="ctx?.source === 'expo'">
                  <span class="text-default truncate block">{{ report.pageUrl }}</span>
                </template>
                <template v-else>
                  <a
                    :href="safeHref(report.pageUrl)"
                    target="_blank"
                    rel="noopener"
                    class="text-primary hover:underline truncate block"
                  >
                    {{ report.pageUrl }}
                  </a>
                </template>
              </dd>
            </div>
            <div class="flex items-start gap-3">
              <dt class="text-muted w-24 shrink-0">Received</dt>
              <dd class="text-default tabular-nums"><RelativeTime :value="report.receivedAt" /></dd>
            </div>
            <div class="flex items-center gap-3">
              <dt class="text-muted w-24 shrink-0">Status</dt>
              <dd>
                <UBadge
                  :color="statusColor(report.status)"
                  variant="soft"
                  size="md"
                  class="rounded-full px-3 font-semibold"
                  :label="statusLabel(report.status)"
                />
              </dd>
            </div>
            <div class="flex items-center gap-3">
              <dt class="text-muted w-24 shrink-0">Urgency</dt>
              <dd>
                <UBadge
                  :color="priorityColor(report.priority)"
                  variant="soft"
                  size="md"
                  class="rounded-full px-3 font-semibold"
                  :label="priorityLabel(report.priority)"
                />
              </dd>
            </div>
            <div v-if="userFileCount > 0" class="flex items-start gap-3 pt-1">
              <dt class="text-muted w-24 shrink-0">Files</dt>
              <dd>
                <button
                  type="button"
                  class="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-sm font-medium text-primary hover:bg-primary/20 transition-colors"
                  @click="emit('select-tab', 'attachments')"
                >
                  <UIcon name="i-heroicons-paper-clip" class="size-3.5" />
                  {{ userFileCount }} additional {{ userFileCount === 1 ? "file" : "files" }}
                </button>
              </dd>
            </div>
          </dl>
        </section>
      </div>
    </div>

    <!-- CONVERSATION — chat-style thread, GitHub-synced. The Comments tab
         renders the same component standalone; embedded here so the
         overview reads as "context above, discussion below" without a
         tab switch. -->
    <section class="overflow-hidden rounded-xl ring-1 ring-default bg-default">
      <header class="px-5 py-3 bg-primary/[0.08] border-b border-default flex items-center gap-2">
        <UIcon name="i-heroicons-chat-bubble-left-right" class="size-4 text-primary" />
        <h3 class="text-sm font-medium text-primary tracking-tight">Comments</h3>
      </header>
      <CommentsTab :project-id="projectId" :report-id="report.id" :can-comment="canComment" />
    </section>

    <!-- Lightbox — full-resolution screenshot. Click the backdrop or press
         Escape to close. Renders into a fixed overlay above the page so
         the screenshot can use the entire viewport. -->
    <Teleport v-if="lightboxOpen" to="body">
      <div
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-6 backdrop-blur-sm"
        role="dialog"
        aria-modal="true"
        aria-label="Screenshot fullscreen"
        @click.self="closeLightbox"
      >
        <button
          type="button"
          aria-label="Close fullscreen"
          class="absolute top-4 right-4 inline-flex items-center gap-2 rounded-lg bg-white/10 px-3 py-2 text-sm font-medium text-white ring-1 ring-white/15 hover:bg-white/20 transition-colors"
          @click="closeLightbox"
        >
          <UIcon name="i-heroicons-x-mark" class="size-4" />
          Close
          <kbd class="ml-1 text-sm text-white/60 tabular-nums">Esc</kbd>
        </button>
        <img
          :src="report.thumbnailUrl ?? ''"
          alt="Report screenshot — full size"
          class="max-h-full max-w-full object-contain rounded-lg shadow-2xl"
        />
      </div>
    </Teleport>
  </div>
</template>
