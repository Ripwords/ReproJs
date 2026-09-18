import { describe, expect, test } from "bun:test"
import type { LogsAttachment } from "@reprojs/shared"
import { useReportLogs } from "../../app/composables/use-report-logs"

const LOGS: LogsAttachment = {
  version: 1,
  console: [],
  network: [],
  breadcrumbs: [],
  config: {
    consoleMax: 100,
    networkMax: 50,
    breadcrumbsMax: 50,
    capturesBodies: false,
    capturesAllHeaders: false,
  },
}

function httpError(statusCode: number, statusMessage: string): Error {
  return Object.assign(new Error(`[GET] "/x": ${statusCode} ${statusMessage}`), {
    name: "FetchError",
    statusCode,
    statusMessage,
    data: { statusCode, statusMessage, message: statusMessage },
  })
}

describe("useReportLogs", () => {
  test("starts idle and does not fetch until asked", () => {
    let calls = 0
    const { state } = useReportLogs({
      url: () => "/logs",
      hasLogs: () => true,
      fetcher: async () => {
        calls++
        return LOGS
      },
    })
    expect(state.value.kind).toBe("idle")
    expect(calls).toBe(0)
  })

  test("is 'missing' without a request when the report has no logs attachment", async () => {
    let calls = 0
    const { state, ensure } = useReportLogs({
      url: () => "/logs",
      hasLogs: () => false,
      fetcher: async () => {
        calls++
        return LOGS
      },
    })
    await ensure()
    expect(state.value.kind).toBe("missing")
    expect(calls).toBe(0)
  })

  test("loads the logs once, even when asked twice", async () => {
    let calls = 0
    const { state, ensure } = useReportLogs({
      url: () => "/logs",
      hasLogs: () => true,
      fetcher: async () => {
        calls++
        return LOGS
      },
    })
    await Promise.all([ensure(), ensure()])
    await ensure()
    expect(calls).toBe(1)
    expect(state.value).toEqual({ kind: "ready", logs: LOGS })
  })

  test("a 404 means the report has no logs, not an endless load", async () => {
    const { state, ensure } = useReportLogs({
      url: () => "/logs",
      hasLogs: () => true,
      fetcher: async () => {
        throw httpError(404, "Attachment not found")
      },
    })
    await ensure()
    expect(state.value.kind).toBe("missing")
  })

  test("other failures surface the server message and can be retried", async () => {
    let fail = true
    const { state, ensure, retry } = useReportLogs({
      url: () => "/logs",
      hasLogs: () => true,
      fetcher: async () => {
        if (fail) throw httpError(500, "Storage unavailable")
        return LOGS
      },
    })
    await ensure()
    expect(state.value).toEqual({ kind: "error", message: "Storage unavailable" })
    // A plain ensure() does not hammer the endpoint after a failure.
    fail = false
    await ensure()
    expect(state.value.kind).toBe("error")
    await retry()
    expect(state.value).toEqual({ kind: "ready", logs: LOGS })
  })

  test("reset drops a stale in-flight response for the previous report", async () => {
    const firstFetch: { resolve?: (v: LogsAttachment) => void } = {}
    let url = "/a"
    const { state, ensure, reset } = useReportLogs({
      url: () => url,
      hasLogs: () => true,
      fetcher: (u) =>
        u === "/a"
          ? new Promise<LogsAttachment>((r) => {
              firstFetch.resolve = r
            })
          : Promise.resolve({ ...LOGS, version: 1 }),
    })
    const first = ensure()
    url = "/b"
    reset()
    expect(state.value.kind).toBe("idle")
    firstFetch.resolve?.(LOGS)
    await first
    expect(state.value.kind).toBe("idle")
  })
})
