import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { AppState, View } from "react-native"
import { ReproContext, type ReproInternalContext } from "./context"
import { normalizeConfig, type ReproConfig, type ReproConfigInput } from "./config"
import { createConsoleCollector } from "./collectors/console"
import { createNetworkCollector } from "./collectors/network"
import { createBreadcrumbsCollector, type Attachment } from "@reprojs/sdk-utils"
import { createQueueStorage, type QueueItemAttachment } from "./queue/storage"
import { createQueueFlusher } from "./queue/flush"
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
  const queueRef = useRef(
    createQueueStorage({ maxReports: config.queue.maxReports, maxBytes: config.queue.maxBytes }),
  )
  const clientRef = useRef(createIntakeClient({ intakeUrl: config.intakeUrl }))
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
      const shot = await captureView(rootRef)
      setScreenshot({ uri: shot.uri, width: rootSize.w, height: rootSize.h })
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
    await queueRef.current.enqueue({
      id,
      createdAt: now,
      payload: {
        input,
        // Build the queue attachment list: screenshot first (if captured),
        // then any user-supplied files from the picker.
        attachments: (() => {
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
          return [...screenshotEntries, ...userFileEntries]
        })(),
        logs: logsJson,
      },
      attempts: 0,
      lastErrorAt: null,
      lastError: null,
    })
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
      const shot = await captureView(rootRef)
      return { ...shot, width: rootSize.w, height: rootSize.h }
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
