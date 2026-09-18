<!-- apps/dashboard/app/components/report-drawer/network-tab.vue -->
<script setup lang="ts">
import AppErrorState from "~/components/common/app-error-state.vue"
import type { ReportLogsState } from "~/composables/use-report-logs"

const props = defineProps<{ state: ReportLogsState }>()
defineEmits<{ retry: [] }>()

const logs = computed(() => (props.state.kind === "ready" ? props.state.logs : null))

const expanded = ref<Set<string>>(new Set())
function toggle(id: string) {
  if (expanded.value.has(id)) expanded.value.delete(id)
  else expanded.value.add(id)
  expanded.value = new Set(expanded.value)
}

type BadgeColor = "error" | "warning" | "neutral" | "primary" | "info" | "success"
function methodColor(m: string): BadgeColor {
  if (m === "POST") return "info"
  if (m === "PUT" || m === "PATCH") return "warning"
  if (m === "DELETE") return "error"
  return "neutral"
}
function statusColor(s: number | null): BadgeColor {
  if (s === null) return "neutral"
  if (s >= 500) return "error"
  if (s >= 400) return "warning"
  if (s >= 200 && s < 300) return "success"
  return "neutral"
}

const fmtMs = (v: number | null) => (v === null ? "—" : `${Math.round(v)}ms`)
const fmtSize = (v: number | null) => {
  if (v === null) return "—"
  if (v < 1024) return `${v}B`
  return `${(v / 1024).toFixed(1)}kB`
}
function shortUrl(url: string): string {
  try {
    const u = new URL(url)
    return u.pathname + (u.search || "")
  } catch {
    return url
  }
}
</script>

<template>
  <div v-if="state.kind === 'error'" class="p-5">
    <AppErrorState title="Couldn't load logs" :message="state.message" @retry="$emit('retry')" />
  </div>
  <div v-else-if="state.kind === 'missing'" class="p-5 text-sm text-muted">
    No logs were captured for this report.
  </div>
  <div v-else-if="!logs" class="p-5 text-sm text-muted">Loading…</div>
  <div v-else-if="logs.network.length === 0" class="p-5 text-sm text-muted">
    No network requests captured in the last {{ logs.config.networkMax }} calls.
  </div>
  <div v-else class="p-3">
    <table class="w-full text-sm">
      <thead class="text-left text-sm font-semibold uppercase tracking-[0.08em] text-muted">
        <tr class="border-b border-default">
          <th class="p-2.5">Method</th>
          <th class="p-2.5">URL</th>
          <th class="p-2.5">Status</th>
          <th class="p-2.5 text-right">Time</th>
          <th class="p-2.5 text-right">Size</th>
        </tr>
      </thead>
      <tbody>
        <template v-for="n in logs.network" :key="n.id">
          <tr
            class="border-b border-default cursor-pointer hover:bg-elevated/40 transition"
            @click="toggle(n.id)"
          >
            <td class="p-2">
              <UBadge :label="n.method" :color="methodColor(n.method)" variant="soft" size="sm" />
            </td>
            <td class="p-2 font-mono text-default max-w-[14rem]">
              <UTooltip :text="n.url">
                <span class="truncate block">{{ shortUrl(n.url) }}</span>
              </UTooltip>
            </td>
            <td class="p-2">
              <UBadge
                :label="n.status === null ? '—' : String(n.status)"
                :color="statusColor(n.status)"
                variant="soft"
                size="sm"
                class="tabular-nums"
              />
            </td>
            <td class="p-2 text-right text-muted">{{ fmtMs(n.durationMs) }}</td>
            <td class="p-2 text-right text-muted">{{ fmtSize(n.size) }}</td>
          </tr>
          <tr v-if="expanded.has(n.id)" class="border-b border-default bg-elevated/40">
            <td colspan="5" class="p-3 text-sm space-y-2">
              <div v-if="n.error" class="text-error">Error: {{ n.error }}</div>
              <div v-if="n.requestHeaders && Object.keys(n.requestHeaders).length">
                <div class="font-semibold text-default mb-1">Request headers</div>
                <pre class="whitespace-pre-wrap text-muted">{{
                  JSON.stringify(n.requestHeaders, null, 2)
                }}</pre>
              </div>
              <div v-if="n.requestBody">
                <div class="font-semibold text-default mb-1">Request body</div>
                <pre class="whitespace-pre-wrap break-all text-muted">{{ n.requestBody }}</pre>
              </div>
              <div v-if="n.responseHeaders && Object.keys(n.responseHeaders).length">
                <div class="font-semibold text-default mb-1">Response headers</div>
                <pre class="whitespace-pre-wrap text-muted">{{
                  JSON.stringify(n.responseHeaders, null, 2)
                }}</pre>
              </div>
              <div v-if="n.responseBody">
                <div class="font-semibold text-default mb-1">Response body</div>
                <pre class="whitespace-pre-wrap break-all text-muted">{{ n.responseBody }}</pre>
              </div>
            </td>
          </tr>
        </template>
      </tbody>
    </table>
  </div>
</template>
