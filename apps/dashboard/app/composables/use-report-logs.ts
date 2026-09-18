import type { LogsAttachment } from "@reprojs/shared"
import { shallowRef } from "vue"
import { describeApiError } from "../utils/api-error"

/**
 * Where a report's logs attachment is in its lifecycle. Console and Network
 * render straight off this, so "still loading", "this report has no logs"
 * and "the request failed" stay distinct states instead of all reading as
 * `null` (which the tabs used to show as a permanent "Loading…").
 */
export type ReportLogsState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; logs: LogsAttachment }
  | { kind: "missing" }
  | { kind: "error"; message: string }

interface Options {
  url: () => string
  /** False when the report row lists no `logs` attachment — skip the request. */
  hasLogs: () => boolean
  fetcher: (url: string) => Promise<LogsAttachment>
}

/**
 * Lazily loads a report's logs attachment the first time a tab needs it.
 * The fetch is triggered by the user opening a tab, not by mount.
 */
export function useReportLogs({ url, hasLogs, fetcher }: Options) {
  const state = shallowRef<ReportLogsState>({ kind: "idle" })
  // Bumped by reset(); a response for an older generation is dropped.
  let generation = 0
  let inflight: Promise<void> | null = null

  function load(): Promise<void> {
    if (!hasLogs()) {
      state.value = { kind: "missing" }
      return Promise.resolve()
    }
    const mine = generation
    state.value = { kind: "loading" }
    const run = settle(mine).finally(() => {
      if (inflight === run) inflight = null
    })
    inflight = run
    return run
  }

  async function settle(mine: number): Promise<void> {
    let next: ReportLogsState
    try {
      next = { kind: "ready", logs: await fetcher(url()) }
    } catch (err) {
      next =
        statusOf(err) === 404
          ? { kind: "missing" }
          : { kind: "error", message: describeApiError(err, "Could not load the logs.") }
    }
    if (mine === generation) state.value = next
  }

  /** Load once. A no-op after success, a known-missing result, or a failure. */
  function ensure(): Promise<void> {
    if (inflight) return inflight
    if (state.value.kind !== "idle") return Promise.resolve()
    return load()
  }

  function retry(): Promise<void> {
    if (inflight) return inflight
    return load()
  }

  /** Forget everything, e.g. when the page switches to another report. */
  function reset(): void {
    generation++
    inflight = null
    state.value = { kind: "idle" }
  }

  return { state, ensure, retry, reset }
}

function statusOf(err: unknown): number | undefined {
  if (typeof err !== "object" || err === null) return undefined
  const { statusCode, status } = err as { statusCode?: unknown; status?: unknown }
  if (typeof statusCode === "number") return statusCode
  if (typeof status === "number") return status
  return undefined
}
