// packages/ui/src/gallery/gallery-view.tsx
import { h } from "preact"
import { useEffect, useRef, useState } from "preact/hooks"
import { formatBytes } from "@reprojs/sdk-utils"
import { BlobImage } from "../blob-image"
import type { GalleryItem, GalleryStore } from "./store"

interface GalleryViewProps {
  store: GalleryStore | null
  canShare: boolean
  onCopyLink: (item: GalleryItem) => Promise<{ url: string } | { error: string }>
  onReportWith: (item: GalleryItem) => void
  onClose: () => void
}

type CopyState = "idle" | "pending" | "copied" | "error"

function msToClock(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, "0")}`
}

// Same objectURL lifecycle + CSP-fallback approach as record/trim-screen.tsx's
// TrimScreen: createObjectURL on mount, revoke on unmount, and a plain-text
// fallback if the host's CSP refuses the blob: load. Playback is additionally
// clamped to `item.trim` when present — undefined trim means "play the full
// clip", matching the semantics adjudicated for Task 5.
function VideoPreview({ item }: { item: GalleryItem }) {
  const [url, setUrl] = useState<string | null>(null)
  const [previewFailed, setPreviewFailed] = useState(false)
  const urlRef = useRef<string | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    try {
      const created = URL.createObjectURL(item.blob)
      urlRef.current = created
      setUrl(created)
    } catch {
      setPreviewFailed(true)
    }
    return () => {
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current)
        urlRef.current = null
      }
    }
  }, [item.blob])

  useEffect(() => {
    const video = videoRef.current
    const trim = item.trim
    if (!video || !trim) return
    const startSec = trim.startMs / 1000
    const endSec = trim.endMs / 1000
    const seekToStart = () => {
      video.currentTime = startSec
    }
    const clampAtEnd = () => {
      if (video.currentTime >= endSec) video.pause()
    }
    video.addEventListener("loadedmetadata", seekToStart)
    video.addEventListener("timeupdate", clampAtEnd)
    return () => {
      video.removeEventListener("loadedmetadata", seekToStart)
      video.removeEventListener("timeupdate", clampAtEnd)
    }
  }, [item.trim, url])

  if (previewFailed) {
    return h(
      "div",
      { class: "ft-gallery-preview-fallback" },
      "Preview unavailable on this site — the recording is intact",
    )
  }
  return h("video", {
    ref: videoRef,
    class: "ft-gallery-preview-video",
    src: url ?? undefined,
    controls: true,
    onError: () => setPreviewFailed(true),
  })
}

interface TileProps {
  item: GalleryItem
  canShare: boolean
  previewOpen: boolean
  copyState: CopyState
  copyError: string | null
  onTogglePreview: (id: string) => void
  onDelete: (id: string) => void
  onCopyLink: (item: GalleryItem) => void
  onReportWith: (item: GalleryItem) => void
}

function Tile({
  item,
  canShare,
  previewOpen,
  copyState,
  copyError,
  onTogglePreview,
  onDelete,
  onCopyLink,
  onReportWith,
}: TileProps) {
  const copyLabel =
    copyState === "pending" ? "Copying…" : copyState === "copied" ? "Copied!" : "Copy link"

  return h(
    "div",
    { class: "ft-gallery-tile", "data-kind": item.kind },
    h(
      "div",
      { class: "ft-gallery-thumb" },
      item.thumb
        ? h(BlobImage, {
            blob: item.thumb,
            alt: `${item.kind} thumbnail`,
            class: "ft-gallery-thumb-img",
          })
        : h(
            "div",
            { class: "ft-gallery-thumb-placeholder", "aria-hidden": "true" },
            item.kind === "video" ? "🎬" : "🖼",
          ),
    ),
    h(
      "div",
      { class: "ft-gallery-caption" },
      item.kind === "video" && item.durationMs != null
        ? h("span", { class: "ft-gallery-duration" }, msToClock(item.durationMs))
        : null,
      h("span", { class: "ft-gallery-size" }, formatBytes(item.sizeBytes)),
    ),
    h(
      "div",
      { class: "ft-gallery-actions" },
      h(
        "button",
        {
          type: "button",
          class: "ft-gallery-action",
          onClick: () => onTogglePreview(item.id),
        },
        previewOpen ? "Hide preview" : "Preview",
      ),
      h(
        "button",
        {
          type: "button",
          class: "ft-gallery-action",
          onClick: () => onDelete(item.id),
        },
        "Delete",
      ),
      item.kind === "video" && canShare
        ? h(
            "button",
            {
              type: "button",
              class: "ft-gallery-action",
              disabled: copyState === "pending",
              onClick: () => onCopyLink(item),
            },
            copyLabel,
          )
        : null,
      h(
        "button",
        {
          type: "button",
          class: "ft-gallery-action ft-gallery-action-primary",
          onClick: () => onReportWith(item),
        },
        "Report bug with this",
      ),
    ),
    copyError ? h("div", { class: "ft-gallery-copy-error" }, copyError) : null,
    previewOpen
      ? h(
          "div",
          { class: "ft-gallery-preview" },
          item.kind === "video"
            ? h(VideoPreview, { item })
            : h(BlobImage, {
                blob: item.blob,
                alt: "Capture preview",
                class: "ft-gallery-preview-image",
              }),
        )
      : null,
  )
}

// Loads store.list() on mount. `store` is nullable because openGallery()
// (Task 4) resolves null when IndexedDB is unavailable — the gallery must
// fail open (render an empty grid) rather than crash the widget.
export function GalleryView({
  store,
  canShare,
  onCopyLink,
  onReportWith,
  onClose,
}: GalleryViewProps) {
  const [items, setItems] = useState<GalleryItem[]>([])
  const [loaded, setLoaded] = useState(false)
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [copyStates, setCopyStates] = useState<Record<string, CopyState>>({})
  const [copyErrors, setCopyErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    let cancelled = false
    if (!store) {
      setLoaded(true)
      return
    }
    ;(async () => {
      const list = await store.list()
      if (!cancelled) {
        setItems(list)
        setLoaded(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [store])

  function togglePreview(id: string) {
    setPreviewId((current) => (current === id ? null : id))
  }

  async function handleDelete(id: string) {
    if (store) await store.remove(id)
    setItems((prev) => prev.filter((i) => i.id !== id))
    setPreviewId((current) => (current === id ? null : current))
  }

  async function handleCopyLink(item: GalleryItem) {
    setCopyStates((s) => ({ ...s, [item.id]: "pending" }))
    setCopyErrors((s) => ({ ...s, [item.id]: "" }))
    const result = await onCopyLink(item)
    if ("url" in result) {
      try {
        await navigator.clipboard.writeText(result.url)
        setCopyStates((s) => ({ ...s, [item.id]: "copied" }))
      } catch {
        setCopyStates((s) => ({ ...s, [item.id]: "error" }))
        setCopyErrors((s) => ({ ...s, [item.id]: "Couldn't copy to clipboard" }))
      }
    } else {
      setCopyStates((s) => ({ ...s, [item.id]: "error" }))
      setCopyErrors((s) => ({ ...s, [item.id]: result.error }))
    }
  }

  return h(
    "div",
    { class: "ft-wizard ft-gallery" },
    h(
      "header",
      { class: "ft-wizard-header ft-gallery-header" },
      h("h2", { class: "ft-wizard-title" }, "Gallery"),
      h(
        "button",
        { type: "button", class: "ft-icon-btn", onClick: onClose, "aria-label": "Close" },
        "✕",
      ),
    ),
    h(
      "div",
      { class: "ft-wizard-body ft-gallery-body" },
      !loaded
        ? h("div", { class: "ft-gallery-loading" }, "Loading…")
        : items.length === 0
          ? h("div", { class: "ft-gallery-empty" }, "No captures yet")
          : h(
              "div",
              { class: "ft-gallery-grid" },
              ...items.map((item) =>
                h(Tile, {
                  key: item.id,
                  item,
                  canShare,
                  previewOpen: previewId === item.id,
                  copyState: copyStates[item.id] ?? "idle",
                  copyError: copyErrors[item.id] || null,
                  onTogglePreview: togglePreview,
                  onDelete: handleDelete,
                  onCopyLink: handleCopyLink,
                  onReportWith,
                }),
              ),
            ),
    ),
  )
}
