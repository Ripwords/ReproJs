import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { AppState, View } from "react-native"
import { ReproContext, type ReproInternalContext } from "./context"
import { normalizeConfig, type ReproConfig, type ReproConfigInput } from "./config"
import { createConsoleCollector } from "./collectors/console"
import { createNetworkCollector } from "./collectors/network"
import { createBreadcrumbsCollector, type Attachment } from "@reprojs/sdk-utils"
import { createQueueStorage, type QueueItemAttachment } from "./queue/storage"
import { createQueueFlusher } from "./queue/flush"
import { createAttachmentStore, loadAttachmentFs } from "./queue/attachment-store"
import { createConnectivityListener } from "./queue/netinfo"
import { createIntakeClient } from "./intake-client"
import { captureView } from "./capture/screenshot"
import { collectSystemInfo } from "./collectors/system-info"
import { WizardSheet } from "./wizard/sheet"
import type { ReporterIdentity, ReportIntakeInput } from "@reprojs/shared"
import { setSingletonHandle, clearSingletonHandle } from "./singleton"

interface Props {
  config: ReproConfigInput
  children: React.ReactNode
}

/**
 * When `projectKey` or `intakeUrl` are empty, the SDK silently disables itself
 * and renders children untouched — no collectors, no launcher, no network. Let
 * hosts opt out with `projectKey: process.env.X ?? ""` rather than a separate
 * `enabled: false` flag.
 */
const DISABLED_CONTEXT: ReproInternalContext = {
  config: null,
  getReporter: () => null,
  setReporter: () => undefined,
  getMetadata: () => ({}),
  setMetadata: () => undefined,
  logBreadcrumb: () => undefined,
  openWizard: () => undefined,
  closeWizard: () => undefined,
  captureRoot: async () => ({ uri: "", width: 0, height: 0 }),
  snapshotBreadcrumbs: () => [],
  queueStatus: () => ({ pending: 0, lastError: null }),
  flushQueue: async () => undefined,
}

/** Must stay >= the dashboard's INTAKE_MIN_DWELL_MS default (1500). */
const MIN_DWELL_MS = 1500

function DisabledProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    setSingletonHandle(DISABLED_CONTEXT)
    // Silent-disable is intentional (it is how hosts switch Repro off per
    // environment), but it must not be *invisible*: with no launcher rendered
    // and no diagnostic, a build whose EXPO_PUBLIC_* vars failed to reach it is
    // indistinguishable from a broken SDK. Warn in dev only, so production
    // opt-outs stay quiet.
    if (typeof __DEV__ !== "undefined" && __DEV__) {
      console.warn(
        "[repro] disabled: projectKey or intakeUrl resolved empty. EXPO_PUBLIC_* values are " +
          "inlined at build time — check the variable exists in the EAS environment your build " +
          "profile declares, then rebuild (an OTA update cannot change a baked-in value).",
      )
    }
    return () => clearSingletonHandle()
  }, [])
  return <ReproContext.Provider value={DISABLED_CONTEXT}>{children}</ReproContext.Provider>
}

export function ReproProvider({ config: rawConfig, children }: Props) {
  const config = useMemo(() => normalizeConfig(rawConfig), [rawConfig])
  if (config === null) {
    return <DisabledProvider>{children}</DisabledProvider>
  }
  return <ActiveProvider config={config}>{children}</ActiveProvider>
}

function ActiveProvider({ config, children }: { config: ReproConfig; children: React.ReactNode }) {
  const rootRef = useRef<View | null>(null)
  const [reporter, setReporter] = useState<ReporterIdentity | null>(config.reporter)
  const [metadata, setMetadata] = useState<Record<string, string | number | boolean>>(
    config.metadata,
  )
  const [wizardOpen, setWizardOpen] = useState(false)
  const wizardOpenedAtRef = useRef<number | null>(null)
  const [wizardInit, setWizardInit] = useState<{
    initialTitle?: string
    initialDescription?: string
  }>({})
  const [screenshot, setScreenshot] = useState<{
    uri: string
    width: number
    height: number
  } | null>(null)
  const [rootSize, setRootSize] = useState({ w: 0, h: 0 })

  const consoleRef = useRef(createConsoleCollector({ max: 200 }))
  const networkRef = useRef(
    createNetworkCollector({
      max: 100,
      captureBodies: config.collectors.network.captureBodies,
      redact: config.redact,
    }),
  )
  const breadcrumbsRef = useRef(createBreadcrumbsCollector({}))
  // Resolved once per provider. `expo-file-system` is a dynamic import so a
  // host that has not installed it still gets a working (if non-durable) queue.
  const [attachmentStore] = useState(() =>
    loadAttachmentFs().then((fs) => {
      if (!fs) {
        console.warn(
          "[repro] expo-file-system is not installed: queued attachments stay in temporary " +
            "storage and may be lost if the app restarts before the report is sent.",
        )
      }
      return createAttachmentStore(fs)
    }),
  )
  const queueRef = useRef(
    createQueueStorage({
      maxReports: config.queue.maxReports,
      maxBytes: config.queue.maxBytes,
      onRemove: async (item) => (await attachmentStore).discard(item.id),
    }),
  )
  const clientRef = useRef(
    createIntakeClient({
      intakeUrl: config.intakeUrl,
      timeoutMs: config.queue.submitTimeoutMs,
    }),
  )
  // Bumped after every flush so `useRepro().queue` re-renders with the real
  // pending count / last error instead of a frozen snapshot.
  const [queueTick, setQueueTick] = useState(0)
  const flusherRef = useRef(
    createQueueFlusher({
      queue: queueRef.current,
      client: clientRef.current,
      backoffMs: config.queue.backoffMs,
      maxAttempts: config.queue.maxAttempts,
      onDrop: ({ id, status, message }) => {
        // A discarded report is data loss. It must never be silent again —
        // this is precisely how a 400 on the logs part swallowed every iOS
        // report while the wizard kept reporting success.
        console.error(
          `[repro] report ${id} was rejected by the intake API (HTTP ${status}) and discarded: ${message}`,
        )
      },
    }),
  )

  const runFlush = useCallback(() => {
    flusherRef.current
      .flush()
      .catch((err: unknown) => {
        console.warn("[repro] queue flush failed", err)
      })
      .finally(() => setQueueTick((n) => n + 1))
  }, [])

  useEffect(() => {
    if (config.collectors.console) consoleRef.current.start()
    if (config.collectors.network.enabled) networkRef.current.start()
    if (config.collectors.breadcrumbs) breadcrumbsRef.current.start({ maxEntries: 50 })
    return () => {
      consoleRef.current.stop()
      networkRef.current.stop()
      breadcrumbsRef.current.stop()
    }
  }, [config.collectors.console, config.collectors.network.enabled, config.collectors.breadcrumbs])

  useEffect(() => {
    const net = createConnectivityListener()
    const unsubscribe = net.subscribe(runFlush)
    const appSub = AppState.addEventListener("change", (state) => {
      if (state === "active") runFlush()
    })
    runFlush()
    const flusher = flusherRef.current
    return () => {
      unsubscribe()
      appSub.remove()
      // Cancel any scheduled retry so an unmounted provider can't keep firing.
      flusher.stop()
    }
  }, [runFlush])

  /**
   * Layout size of the root view. `onLayout` normally supplies it, but the
   * wizard can be opened (e.g. `Repro.open()` on mount) before that first
   * event, and a 0x0 size makes the annotate step a blank canvas. Measure
   * live in that case; give up after a short wait rather than hang.
   */
  async function resolveRootSize(): Promise<{ w: number; h: number }> {
    if (rootSize.w > 0 && rootSize.h > 0) return rootSize
    const node = rootRef.current
    if (!node) return rootSize
    const measured = new Promise<{ w: number; h: number } | null>((resolve) => {
      node.measure((_x, _y, width, height) => {
        const size = { w: Math.round(width), h: Math.round(height) }
        resolve(size.w > 0 && size.h > 0 ? size : null)
      })
    })
    // `measure` never calls back for a view that is not laid out yet.
    const gaveUp = new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), 250)
    })
    const size = await Promise.race([measured, gaveUp])
    if (!size) return rootSize
    setRootSize(size)
    return size
  }

  async function openWizard(opts?: { initialTitle?: string; initialDescription?: string }) {
    setWizardInit(opts ?? {})
    wizardOpenedAtRef.current = Date.now()
    if (!rootRef.current) {
      console.warn("[repro] rootRef not mounted — opening wizard without screenshot")
      setScreenshot(null)
      setWizardOpen(true)
      return
    }
    try {
      const [shot, size] = await Promise.all([captureView(rootRef), resolveRootSize()])
      setScreenshot({ uri: shot.uri, width: size.w, height: size.h })
    } catch (err) {
      console.warn("[repro] screenshot capture failed — opening wizard anyway", err)
      setScreenshot(null)
    }
    setWizardOpen(true)
  }

  async function handleSubmit(res: {
    title: string
    description: string
    annotatedUri: string | null
    rawUri: string | null
    attachments: Attachment[]
  }) {
    const consoleEntries = config.collectors.console ? consoleRef.current.snapshot() : []
    const networkEntries = config.collectors.network.enabled ? networkRef.current.snapshot() : []
    const breadcrumbs = config.collectors.breadcrumbs ? breadcrumbsRef.current.snapshot() : []
    const hasAnyLogs =
      consoleEntries.length > 0 || networkEntries.length > 0 || breadcrumbs.length > 0
    const logsJson = hasAnyLogs
      ? JSON.stringify({
          version: 1 as const,
          console: consoleEntries,
          network: networkEntries,
          breadcrumbs,
          config: {
            consoleMax: 200,
            networkMax: 100,
            breadcrumbsMax: 50,
            capturesBodies: config.collectors.network.captureBodies,
            capturesAllHeaders: false,
          },
        })
      : undefined
    const systemInfo = config.collectors.systemInfo
      ? await collectSystemInfo({ pageUrl: "app://current" })
      : undefined
    const now = new Date().toISOString()
    // Anti-abuse gate on intake rejects _dwellMs < INTAKE_MIN_DWELL_MS, whose
    // server default is 1500 (apps/dashboard/server/lib/env.ts). The floor here
    // must clear that default: it previously clamped to 1000, so the very
    // fallback meant to survive clock skew / a null reset produced a value the
    // server could never accept.
    const dwellStart = wizardOpenedAtRef.current
    const dwellMs =
      dwellStart !== null ? Math.max(MIN_DWELL_MS, Date.now() - dwellStart) : MIN_DWELL_MS
    const input: ReportIntakeInput = {
      projectKey: config.projectKey,
      title: res.title,
      description: res.description || undefined,
      context: {
        source: "expo",
        pageUrl: "app://current",
        userAgent: systemInfo?.userAgent ?? "Expo",
        viewport: { w: rootSize.w || 1, h: rootSize.h || 1 },
        timestamp: now,
        reporter: reporter ?? undefined,
        metadata,
        systemInfo,
      },
      metadata,
      _dwellMs: dwellMs,
    }
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    // Queue attachment list: screenshot first (if captured), then any
    // user-supplied files from the picker.
    const screenshotUri = res.annotatedUri ?? res.rawUri
    const screenshotEntries: QueueItemAttachment[] = screenshotUri
      ? [{ kind: "screenshot" as const, uri: screenshotUri, bytes: 0 }]
      : []
    const userFileEntries: QueueItemAttachment[] = res.attachments.map((a) => ({
      kind: "user-file" as const,
      // previewUrl carries the file:// uri from expo-document-picker.
      uri: a.previewUrl ?? a.id,
      bytes: a.size,
      filename: a.filename,
      contentType: a.mime,
    }))
    // Copy out of tmp/ and the cache dir before the report is persisted, so a
    // queued report survives an app restart or update. Also fills in the real
    // screenshot size, which the queue's maxBytes cap depends on.
    const attachments = await (
      await attachmentStore
    ).persist(id, [...screenshotEntries, ...userFileEntries])
    const { evictedIds } = await queueRef.current.enqueue({
      id,
      createdAt: now,
      payload: {
        input,
        attachments,
        logs: logsJson,
      },
      attempts: 0,
      lastErrorAt: null,
      lastError: null,
    })
    if (evictedIds.length > 0) {
      // Eviction is data loss, same as a drop: the oldest unsent reports were
      // discarded to make room. Say so, with ids, instead of vanishing them.
      console.error(
        `[repro] queue full (maxReports ${config.queue.maxReports}, maxBytes ${config.queue.maxBytes}): ` +
          `discarded unsent report(s) ${evictedIds.join(", ")} to make room for ${id}`,
      )
    }
    setWizardOpen(false)
    setScreenshot(null)
    runFlush()
  }

  void queueTick
  const ctx: ReproInternalContext = {
    config,
    getReporter: () => reporter,
    setReporter,
    getMetadata: () => metadata,
    setMetadata: (patch) => setMetadata((m) => ({ ...m, ...patch })),
    logBreadcrumb: (event, data) => breadcrumbsRef.current.breadcrumb(event, data),
    openWizard,
    closeWizard: () => setWizardOpen(false),
    captureRoot: async () => {
      const [shot, size] = await Promise.all([captureView(rootRef), resolveRootSize()])
      return { ...shot, width: size.w, height: size.h }
    },
    snapshotBreadcrumbs: () => breadcrumbsRef.current.snapshot(),
    // Reads the flusher's real snapshot. This used to be a hardcoded
    // `{ pending: 0, lastError: null }`, so `useRepro().queue` reported a
    // healthy empty queue no matter what was actually happening.
    queueStatus: () => flusherRef.current.status(),
    flushQueue: () => flusherRef.current.flush(),
  }

  useEffect(() => {
    setSingletonHandle(ctx)
    return () => clearSingletonHandle()
  })

  return (
    <ReproContext.Provider value={ctx}>
      <View
        ref={rootRef}
        collapsable={false}
        onLayout={(e) =>
          setRootSize({
            w: Math.round(e.nativeEvent.layout.width),
            h: Math.round(e.nativeEvent.layout.height),
          })
        }
        style={{ flex: 1 }}
      >
        {children}
      </View>
      {wizardOpen && (
        <WizardSheet
          initialTitle={wizardInit.initialTitle}
          initialDescription={wizardInit.initialDescription}
          screenshot={screenshot}
          onSubmit={handleSubmit}
          onClose={() => setWizardOpen(false)}
        />
      )}
    </ReproContext.Provider>
  )
}
