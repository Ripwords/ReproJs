// apps/dashboard/app/composables/use-report-stream.ts
//
// Client-side subscription to the per-report SSE endpoint. Uses VueUse's
// `useEventSource`, which is the Nuxt-documented GET-based SSE consumer
// (https://nuxt.com/docs/4.x/getting-started/data-fetching#consuming-sse-server-sent-events-via-post-request).
//
// The server stamps every frame with a unique nonce — without that, two
// back-to-back frames with identical kind+payload would serialise to the
// same string, and Vue's `watch(data)` does a strict-equality check which
// would coalesce them into a single handler call. The nonce guarantees every
// frame bumps the ref and triggers the watcher.
//
// Memory-safety: `useEventSource` closes the underlying connection on the
// component's setup scope disposal. We layer an explicit `onBeforeUnmount`
// close() on top as a belt-and-suspenders, plus the watcher stops with the
// setup scope automatically.
//
// Reconnect: `useEventSource`'s `autoReconnect` caps retries so we don't
// burn battery on mobile during prolonged outages.

import { onBeforeUnmount, watch } from "vue"
import { useEventSource } from "@vueuse/core"

export type ReportStreamEvent = {
  kind:
    | "triage"
    | "comment_added"
    | "comment_edited"
    | "comment_deleted"
    | "github_synced"
    | "github_linked"
    | "github_unlinked"
  payload?: Record<string, unknown>
}

export function useReportStream(
  projectId: () => string,
  reportId: () => string,
  onEvent: (event: ReportStreamEvent) => void,
) {
  const url = computed(() => `/api/projects/${projectId()}/reports/${reportId()}/stream`)

  const { data, status, close } = useEventSource(url, [], {
    autoReconnect: {
      retries: 10,
      delay: 2_000,
      onFailed() {
        console.warn("[report-stream] giving up after 10 reconnect attempts")
      },
    },
  })

  watch(data, (raw) => {
    if (!raw) return
    try {
      const parsed = JSON.parse(raw) as ReportStreamEvent
      onEvent(parsed)
    } catch {
      // Malformed payload — ignore rather than tear down the stream.
    }
  })

  onBeforeUnmount(() => {
    close()
  })

  return { status }
}
