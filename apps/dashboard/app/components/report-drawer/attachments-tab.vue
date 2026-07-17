<!-- apps/dashboard/app/components/report-drawer/attachments-tab.vue -->
<script setup lang="ts">
import type { AttachmentDTO } from "@reprojs/shared"
import TrimVideo from "~/components/report-drawer/trim-video.vue"

const props = defineProps<{
  attachments: AttachmentDTO[]
}>()

// The tab covers two attachment kinds: "user-file" (generic uploads, shown
// as Images/Files below) and "media" (widget gallery screenshots + trimmed
// recordings, shown in their own Media section further down).
const userFiles = computed(() => props.attachments.filter((a) => a.kind === "user-file"))
const images = computed(() => userFiles.value.filter((a) => a.contentType.startsWith("image/")))
const others = computed(() => userFiles.value.filter((a) => !a.contentType.startsWith("image/")))

const media = computed(() => props.attachments.filter((a) => a.kind === "media"))
const mediaImages = computed(() => media.value.filter((a) => a.contentType.startsWith("image/")))
const mediaVideos = computed(() => media.value.filter((a) => a.contentType.startsWith("video/")))

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function truncate(name: string, max = 40): string {
  if (name.length <= max) return name
  const head = name.slice(0, Math.floor(max / 2) - 1)
  const tail = name.slice(-Math.floor(max / 2))
  return `${head}…${tail}`
}

function relativeTime(iso: string | null): string {
  if (!iso) return ""
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000))
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return `${days}d ago`
}

interface ScanBadge {
  status: "clean" | "unknown"
  label: string
  detail: string
  tone: "success" | "muted"
}

function scanBadge(file: AttachmentDTO): ScanBadge {
  if (file.scanStatus === "clean") {
    const engine = file.scanEngine ?? "AV"
    const duration = file.scanDurationMs != null ? `${file.scanDurationMs}ms` : ""
    const when = relativeTime(file.scannedAt)
    const detailParts = [engine, duration, when].filter((p) => p.length > 0)
    return {
      status: "clean",
      label: "Scanned clean",
      detail: detailParts.join(" · "),
      tone: "success",
    }
  }
  return {
    status: "unknown",
    label: "Not scanned",
    detail: "no virus scan recorded for this file",
    tone: "muted",
  }
}
</script>

<template>
  <div class="space-y-6 p-4">
    <p v-if="userFiles.length === 0 && media.length === 0" class="text-sm text-muted italic">
      No additional attachments on this report.
    </p>

    <section v-if="mediaImages.length > 0 || mediaVideos.length > 0" class="space-y-3">
      <h3 class="text-xs font-semibold uppercase tracking-wide text-muted">
        Media ({{ media.length }})
      </h3>
      <div v-if="mediaImages.length > 0" class="grid grid-cols-3 gap-3">
        <div v-for="img in mediaImages" :key="img.id" class="space-y-1.5">
          <a
            :href="img.url"
            target="_blank"
            rel="noopener"
            class="block aspect-square overflow-hidden rounded-md border border-default bg-elevated/40"
            :title="img.filename ?? ''"
          >
            <img
              :src="img.url"
              :alt="img.filename ?? 'attachment'"
              class="h-full w-full object-cover"
              @error="($event.target as HTMLImageElement).style.display = 'none'"
            />
          </a>
          <div
            class="flex items-center gap-1 text-[11px]"
            :class="scanBadge(img).tone === 'success' ? 'text-success' : 'text-muted'"
            :title="scanBadge(img).detail"
          >
            <UIcon
              :name="
                scanBadge(img).status === 'clean'
                  ? 'i-heroicons-shield-check'
                  : 'i-heroicons-shield-exclamation'
              "
              class="size-3 shrink-0"
            />
            <span class="truncate">{{ scanBadge(img).label }}</span>
          </div>
        </div>
      </div>
      <div v-if="mediaVideos.length > 0" class="space-y-4">
        <TrimVideo
          v-for="vid in mediaVideos"
          :key="vid.id"
          :src="vid.url"
          :trim-start-ms="vid.trimStartMs"
          :trim-end-ms="vid.trimEndMs"
          :download-name="vid.filename ?? 'recording'"
        />
      </div>
    </section>

    <section v-if="images.length > 0" class="space-y-3">
      <h3 class="text-xs font-semibold uppercase tracking-wide text-muted">
        Images ({{ images.length }})
      </h3>
      <div class="grid grid-cols-3 gap-3">
        <div v-for="img in images" :key="img.url" class="space-y-1.5">
          <a
            :href="img.url"
            target="_blank"
            rel="noopener"
            class="block aspect-square overflow-hidden rounded-md border border-default bg-elevated/40"
            :title="img.filename ?? ''"
          >
            <img
              :src="img.url"
              :alt="img.filename ?? 'attachment'"
              class="h-full w-full object-cover"
              @error="($event.target as HTMLImageElement).style.display = 'none'"
            />
          </a>
          <div
            class="flex items-center gap-1 text-[11px]"
            :class="scanBadge(img).tone === 'success' ? 'text-success' : 'text-muted'"
            :title="scanBadge(img).detail"
          >
            <UIcon
              :name="
                scanBadge(img).status === 'clean'
                  ? 'i-heroicons-shield-check'
                  : 'i-heroicons-shield-exclamation'
              "
              class="size-3 shrink-0"
            />
            <span class="truncate">{{ scanBadge(img).label }}</span>
          </div>
        </div>
      </div>
    </section>

    <section v-if="others.length > 0" class="space-y-3">
      <h3 class="text-xs font-semibold uppercase tracking-wide text-muted">
        Files ({{ others.length }})
      </h3>
      <ul class="divide-y divide-default rounded-md border border-default">
        <li v-for="file in others" :key="file.url" class="flex items-start gap-3 px-3 py-2.5">
          <UIcon name="i-heroicons-document" class="mt-0.5 size-4 shrink-0 text-muted" />
          <div class="min-w-0 flex-1">
            <div class="truncate text-sm text-default" :title="file.filename ?? ''">
              {{ truncate(file.filename ?? "(unnamed)") }}
            </div>
            <div class="text-xs tabular-nums text-muted">
              {{ file.contentType }} · {{ formatBytes(file.sizeBytes) }}
            </div>
            <div
              class="mt-1 flex items-center gap-1 text-[11px]"
              :class="scanBadge(file).tone === 'success' ? 'text-success' : 'text-muted'"
              :title="scanBadge(file).detail"
            >
              <UIcon
                :name="
                  scanBadge(file).status === 'clean'
                    ? 'i-heroicons-shield-check'
                    : 'i-heroicons-shield-exclamation'
                "
                class="size-3 shrink-0"
              />
              <span class="truncate">
                <template v-if="scanBadge(file).status === 'clean'">
                  {{ scanBadge(file).label }}
                  <span class="text-muted">· {{ scanBadge(file).detail }}</span>
                </template>
                <template v-else>{{ scanBadge(file).label }}</template>
              </span>
            </div>
          </div>
          <a
            :href="file.url"
            :download="file.filename ?? ''"
            class="text-xs font-medium text-primary-600 dark:text-primary-400 hover:underline"
          >
            Download
          </a>
        </li>
      </ul>
    </section>
  </div>
</template>
