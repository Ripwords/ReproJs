// packages/ui/src/mount.ts
import { h, render } from "preact"
import { useEffect, useRef, useState } from "preact/hooks"
import type { Attachment, TrimRange } from "@reprojs/sdk-utils"
import { CaptureFlow, type PendingMediaItem } from "./capture-flow"
import { GalleryView } from "./gallery/gallery-view"
import {
  openGallery as openGalleryStore,
  type GalleryItem,
  type GalleryStore,
} from "./gallery/store"
import { makeThumbnail } from "./gallery/thumbnail"
import { Launcher } from "./launcher"
import { LauncherMenu } from "./menu"
import { RecordControlBar } from "./record/control-bar"
import { OutcomeBar } from "./record/outcome-bar"
import { TrimScreen } from "./record/trim-screen"
import { Reporter, type ReporterSubmitResult } from "./reporter"
import { createShadowHost, injectStyles, unmountShadowHost } from "./shadow"
import cssText from "./styles-inline"
import { BlobImage } from "./blob-image"
import { themeToCssVars } from "./wizard/theme-css"

export type WidgetMode = "closed" | "menu" | "capture" | "record" | "trim" | "gallery" | "report"

// Structural mirrors of core's RecordingResult / RecordingSession. Duplicated
// here (not imported) because @reprojs/core depends on @reprojs/ui, never the
// reverse — importing back would create a build cycle.
export interface RecordingResultLike {
  blob: Blob
  mime: string
  durationMs: number
}
export type RecordingEndReasonLike = "stopped" | "auto" | "track-ended" | "cancelled" | "error"
export interface RecordingSessionLike {
  stop(): void
  cancel(): void
  snapshot(): RecordingResultLike | null
}

export interface PendingShareInput {
  blob: Blob
  mime: string
  durationMs?: number
  trim?: TrimRange
}

export interface MountOptions {
  config: {
    position: "bottom-right" | "bottom-left" | "top-right" | "top-left"
    launcher: boolean
  }
  capture: () => Promise<Blob | null>
  // Wraps core's startScreenRecording. Resolves null when recording is denied
  // or unavailable (fail open). The returned session is first-trigger-wins:
  // once onEnd fires, stop/cancel/snapshot become no-ops.
  startRecording: (cb: {
    onTick: (elapsedMs: number) => void
    onEnd: (result: RecordingResultLike | null, reason: RecordingEndReasonLike) => void
  }) => Promise<RecordingSessionLike | null>
  // Mints a short-lived share link for a video. Undefined until Task 15 — the
  // gallery renders with sharing disabled while it's absent.
  mintShareLink?: (
    item: PendingShareInput,
  ) => Promise<{ url: string; token: string; expiresAt: string } | { error: string }>
  onSubmit: (payload: {
    title: string
    description: string
    media: GalleryItem[]
    attachments: Attachment[]
    dwellMs: number
    honeypot: string
  }) => Promise<ReporterSubmitResult>
  // Fired when the widget leaves the "closed" mode (launcher click, hotkey, or
  // any programmatic open). Core uses it to pause the rolling replay buffer so
  // the recording captures pre-click activity, not the user's report flow.
  onOpen?: () => void
  // Fired when the widget returns to the "closed" mode. Core resumes replay.
  onClose?: () => void
}

const MAX_RECORDING_MS = 300_000

// Internal record sub-phase (mode is "record" while filming, "trim" while
// trimming + choosing an outcome).
type RecordState =
  | { phase: "recording"; elapsedMs: number }
  | { phase: "trim"; result: RecordingResultLike }
  | { phase: "outcome"; result: RecordingResultLike; trim: TrimRange | undefined }

interface WidgetApi {
  openMenu(): void
  openCapture(): void
  openRecord(): void
  openGalleryMode(): void
  openReport(): void
  close(): void
}

let _api: WidgetApi | null = null
let _opts: MountOptions | null = null
let _root: ShadowRoot | null = null
let _container: HTMLElement | null = null

function newId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  if (c?.randomUUID) {
    try {
      return c.randomUUID()
    } catch {
      // fall through
    }
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function App() {
  const opts = _opts
  const [mode, setMode] = useState<WidgetMode>("closed")
  const [openedAt, setOpenedAt] = useState(0)
  const [preselect, setPreselect] = useState<string | null>(null)
  const [gallery, setGallery] = useState<GalleryStore | null>(null)
  const [record, setRecord] = useState<RecordState | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const sessionRef = useRef<RecordingSessionLike | null>(null)
  const pagehideRef = useRef<((e: Event) => void) | null>(null)
  const returnToReportRef = useRef(false)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Flipped false first thing in the mount-lifetime cleanup below, before
  // sessionRef.current?.cancel() runs. Guards callbacks (onTick/onEnd) that
  // may still fire — synchronously from cancel() itself, or asynchronously
  // once the underlying MediaRecorder actually stops — after the tree has
  // already been torn down.
  const mountedRef = useRef(true)

  // Load the gallery store once. openGallery() resolves null when IndexedDB is
  // unavailable — fail open (Reporter / GalleryView render an empty grid).
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const store = await openGalleryStore()
      if (!cancelled) setGallery(store)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Fire onOpen on the closed→open edge and onClose on the open→closed edge.
  // Tracking the previous mode (not just a boolean) keeps onOpen from re-firing
  // across open→open switches (menu → capture → report). Skip the initial mount
  // so we don't fire onClose before the user has done anything.
  const mounted = useRef(false)
  const prevMode = useRef<WidgetMode>("closed")
  useEffect(() => {
    const was = prevMode.current
    prevMode.current = mode
    if (!mounted.current) {
      mounted.current = true
      return
    }
    const wasOpen = was !== "closed"
    const isOpen = mode !== "closed"
    if (!wasOpen && isOpen) opts?.onOpen?.()
    else if (wasOpen && !isOpen) opts?.onClose?.()
  }, [mode])

  function showToast(message: string) {
    setToast(message)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 3200)
  }

  function detachPagehide() {
    if (pagehideRef.current) {
      window.removeEventListener("pagehide", pagehideRef.current)
      pagehideRef.current = null
    }
  }

  // Mount-lifetime cleanup. init() re-mounts by calling unmount() when the
  // widget is already mounted (see core's init()), so an active recording
  // session's MediaRecorder/getDisplayMedia stream and the pagehide listener
  // must be torn down here — otherwise the browser keeps showing "sharing
  // your screen" after the widget is gone and the listener leaks a stale
  // closure. cancel() is a no-op once a session has already ended (session's
  // first-trigger-wins semantics), so this is safe to call unconditionally.
  useEffect(() => {
    return () => {
      mountedRef.current = false
      sessionRef.current?.cancel()
      sessionRef.current = null
      detachPagehide()
      if (toastTimer.current) {
        clearTimeout(toastTimer.current)
        toastTimer.current = null
      }
    }
  }, [])

  async function saveToGallery(item: PendingMediaItem): Promise<string | null> {
    if (!gallery) {
      showToast("Gallery unavailable — capture not saved")
      return null
    }
    const thumb = await makeThumbnail(item.blob, item.kind)
    const gi: GalleryItem = {
      id: newId(),
      kind: item.kind,
      blob: item.blob,
      thumb,
      mime: item.mime,
      sizeBytes: item.blob.size,
      ...(item.durationMs !== undefined ? { durationMs: item.durationMs } : {}),
      ...(item.trim ? { trim: item.trim } : {}),
      createdAt: Date.now(),
    }
    const { evicted } = await gallery.add(gi)
    // store.add evicts oldest-first, so evicted[0] is the oldest dropped item.
    const oldest = evicted[0]
    if (oldest) {
      showToast(`Gallery full — removed the oldest ${oldest.kind} to make room`)
    }
    return gi.id
  }

  // Shared exit after a capture/record item is resolved. When the flow was
  // launched from inside the report wizard ("Capture now" / "Record now") we
  // return to the wizard; otherwise the menu-origin flow closes the widget.
  function afterMediaSaved(newIdValue: string | null, action: "saved" | "report") {
    if (action === "report") {
      returnToReportRef.current = false
      if (newIdValue) setPreselect(newIdValue)
      setMode("report")
      return
    }
    // action === "saved"
    if (returnToReportRef.current) {
      returnToReportRef.current = false
      if (newIdValue) setPreselect(newIdValue)
      setMode("report")
    } else {
      showToast("Saved to gallery")
      setMode("closed")
    }
  }

  function afterMediaDiscarded() {
    if (returnToReportRef.current) {
      returnToReportRef.current = false
      setMode("report")
    } else {
      setMode("closed")
    }
  }

  function openReportMode(fromReturn = false) {
    if (!fromReturn) {
      returnToReportRef.current = false
      setPreselect(null)
    }
    const now = performance.now()
    setOpenedAt(now)
    setMode("report")
  }

  async function startRecord() {
    if (!opts) return
    detachPagehide()
    setRecord({ phase: "recording", elapsedMs: 0 })
    setMode("record")
    const session = await opts.startRecording({
      onTick: (ms) => {
        if (!mountedRef.current) return
        setRecord({ phase: "recording", elapsedMs: ms })
      },
      onEnd: (result, reason) => {
        if (!mountedRef.current) return
        handleRecordEnd(result, reason)
      },
    })
    if (!mountedRef.current) {
      // Unmounted while the getDisplayMedia prompt was pending. The
      // mount-lifetime cleanup already ran (and found no session to cancel),
      // so release this newly-started stream ourselves — otherwise it never
      // gets cancelled and the browser keeps showing "sharing your screen".
      session?.cancel()
      return
    }
    if (!session) {
      // Denied or unavailable — fail open back to the menu with a hint.
      showToast("Screen recording unavailable")
      setRecord(null)
      setMode("menu")
      return
    }
    sessionRef.current = session
    // Best-effort flush of the in-progress recording if the tab is torn down
    // mid-capture. IndexedDB may not settle before unload — that's acceptable.
    const onPagehide = () => {
      const snap = sessionRef.current?.snapshot()
      if (snap && snap.blob.size > 0) {
        void saveToGallery({
          kind: "video",
          blob: snap.blob,
          mime: snap.mime,
          durationMs: snap.durationMs,
        })
      }
    }
    pagehideRef.current = onPagehide
    window.addEventListener("pagehide", onPagehide)
  }

  function handleRecordEnd(result: RecordingResultLike | null, reason: RecordingEndReasonLike) {
    sessionRef.current = null
    detachPagehide()
    if (result && result.blob.size > 0) {
      setRecord({ phase: "trim", result })
      setMode("trim")
      return
    }
    // Cancelled, empty, or errored — return to the menu (with a hint on error).
    if (reason === "error") showToast("Recording failed")
    setRecord(null)
    setMode(returnToReportRef.current ? "report" : "menu")
    if (returnToReportRef.current) returnToReportRef.current = false
  }

  // Wire the module-level imperative API to this render's setters.
  _api = {
    openMenu: () => setMode("menu"),
    openCapture: () => {
      returnToReportRef.current = false
      setMode("capture")
    },
    openRecord: () => {
      returnToReportRef.current = false
      void startRecord()
    },
    openGalleryMode: () => setMode("gallery"),
    openReport: () => openReportMode(false),
    close: () => {
      sessionRef.current?.cancel()
      sessionRef.current = null
      detachPagehide()
      setRecord(null)
      setMode("closed")
    },
  }

  const launcher =
    opts?.config.launcher && !(mode === "record" && record?.phase === "recording")
      ? h(Launcher, { position: opts.config.position, onClick: () => setMode("menu") })
      : null

  let panel = null
  if (mode === "menu") {
    panel = h(LauncherMenu, {
      position: opts?.config.position ?? "bottom-right",
      onCapture: () => {
        returnToReportRef.current = false
        setMode("capture")
      },
      onRecord: () => {
        returnToReportRef.current = false
        void startRecord()
      },
      onReport: () => openReportMode(false),
      onGallery: () => setMode("gallery"),
      onClose: () => setMode("closed"),
    })
  } else if (mode === "capture") {
    panel = h(CaptureFlow, {
      onCapture: opts?.capture ?? (async () => null),
      onDone: (outcome) => {
        if (outcome.action === "discarded") {
          afterMediaDiscarded()
          return
        }
        void (async () => {
          const id = await saveToGallery(outcome.item)
          afterMediaSaved(id, outcome.action === "report" ? "report" : "saved")
        })()
      },
    })
  } else if (mode === "record" && record?.phase === "recording") {
    panel = h(RecordControlBar, {
      elapsedMs: record.elapsedMs,
      maxMs: MAX_RECORDING_MS,
      onStop: () => sessionRef.current?.stop(),
      onCancel: () => sessionRef.current?.cancel(),
    })
  } else if (mode === "trim" && record?.phase === "trim") {
    const { result } = record
    panel = h(TrimScreen, {
      blob: result.blob,
      durationMs: result.durationMs,
      onConfirm: (trim: TrimRange | undefined) => setRecord({ phase: "outcome", result, trim }),
      onCancel: () => {
        setRecord(null)
        setMode(returnToReportRef.current ? "report" : "menu")
        if (returnToReportRef.current) returnToReportRef.current = false
      },
    })
  } else if (mode === "trim" && record?.phase === "outcome") {
    const { result, trim } = record
    const buildItem = (): PendingMediaItem => ({
      kind: "video",
      blob: result.blob,
      mime: result.mime,
      durationMs: result.durationMs,
      ...(trim ? { trim } : {}),
    })
    panel = h(
      "div",
      { class: "ft-wizard ft-capture-outcome" },
      h(
        "div",
        { class: "ft-wizard-body ft-outcome-body" },
        h(BlobImage, { blob: result.blob, alt: "Recording", class: "ft-outcome-preview" }),
      ),
      h(OutcomeBar, {
        kind: "video",
        onSave: () => {
          void (async () => {
            const id = await saveToGallery(buildItem())
            setRecord(null)
            afterMediaSaved(id, "saved")
          })()
        },
        onDiscard: () => {
          setRecord(null)
          afterMediaDiscarded()
        },
        onReport: () => {
          void (async () => {
            const id = await saveToGallery(buildItem())
            setRecord(null)
            afterMediaSaved(id, "report")
          })()
        },
      }),
    )
  } else if (mode === "gallery") {
    panel = h(GalleryView, {
      store: gallery,
      canShare: Boolean(opts?.mintShareLink),
      onCopyLink: async (item: GalleryItem) => {
        if (!opts?.mintShareLink) return { error: "Sharing unavailable" }
        const res = await opts.mintShareLink({
          blob: item.blob,
          mime: item.mime,
          ...(item.durationMs !== undefined ? { durationMs: item.durationMs } : {}),
          ...(item.trim ? { trim: item.trim } : {}),
        })
        if ("url" in res) {
          await gallery?.update(item.id, {
            shareUrl: res.url,
            shareToken: res.token,
            shareExpiresAt: res.expiresAt,
          })
          return { url: res.url }
        }
        return { error: res.error }
      },
      onReportWith: (item: GalleryItem) => {
        returnToReportRef.current = false
        setPreselect(item.id)
        setOpenedAt(performance.now())
        setMode("report")
      },
      onClose: () => setMode("closed"),
    })
  } else if (mode === "report") {
    panel = h(Reporter, {
      onClose: () => setMode("closed"),
      onSubmit: opts?.onSubmit ?? (async () => ({ ok: false, message: "not mounted" })),
      openedAt,
      gallery,
      preselectedId: preselect ?? undefined,
      onCaptureNow: () => {
        returnToReportRef.current = true
        setMode("capture")
      },
      onRecordNow: () => {
        returnToReportRef.current = true
        void startRecord()
      },
    })
  }

  return h(
    "div",
    null,
    launcher,
    panel,
    toast
      ? h("div", { class: "ft-mode-toast", role: "status", "aria-live": "polite" }, toast)
      : null,
  )
}

export function mount(opts: MountOptions) {
  _opts = opts
  _root = createShadowHost()
  injectStyles(_root, themeToCssVars())
  injectStyles(_root, cssText)
  _container = document.createElement("div")
  _root.appendChild(_container)
  render(h(App, null), _container)
}

// Programmatic open — jumps straight to the report wizard (back-compat with the
// pre-menu SDK where the launcher opened the reporter directly).
export function open() {
  _api?.openReport()
}

export function openMenu() {
  _api?.openMenu()
}

export function openCapture() {
  _api?.openCapture()
}

export function openRecord() {
  _api?.openRecord()
}

export function openGallery() {
  _api?.openGalleryMode()
}

export function close() {
  _api?.close()
}

export function unmount() {
  if (_container) render(null, _container)
  unmountShadowHost()
  _container = null
  _root = null
  _api = null
  _opts = null
}
