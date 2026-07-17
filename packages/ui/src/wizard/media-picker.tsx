import { h } from "preact"
import { formatBytes } from "@reprojs/sdk-utils"
import { BlobImage } from "../blob-image"
import type { GalleryItem } from "../gallery/store"
import { SecondaryButton } from "./controls"

interface Props {
  items: GalleryItem[]
  selectedIds: string[]
  errors: string[]
  onToggle: (id: string) => void
  onCaptureNow: () => void
  onRecordNow: () => void
}

// Duplicated in gallery-view.tsx / record/control-bar.tsx / record/trim-screen.tsx
// rather than shared — same tiny-helper convention used across the wizard/gallery
// UI in this package.
function msToClock(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, "0")}`
}

export function MediaPicker({
  items,
  selectedIds,
  errors,
  onToggle,
  onCaptureNow,
  onRecordNow,
}: Props) {
  return h(
    "div",
    { class: "ft-media" },
    items.length > 0
      ? h(
          "div",
          { class: "ft-media-grid" },
          ...items.map((item) => {
            const selected = selectedIds.includes(item.id)
            return h(
              "button",
              {
                type: "button",
                class: `ft-media-item${selected ? " selected" : ""}`,
                "aria-pressed": selected,
                key: item.id,
                onClick: () => onToggle(item.id),
              },
              h(
                "div",
                { class: "ft-media-thumb" },
                item.thumb
                  ? h(BlobImage, {
                      blob: item.thumb,
                      alt: `${item.kind} thumbnail`,
                      class: "ft-media-thumb-img",
                    })
                  : h(
                      "div",
                      { class: "ft-media-thumb-placeholder", "aria-hidden": "true" },
                      item.kind === "video" ? "🎬" : "🖼",
                    ),
                selected ? h("div", { class: "ft-media-check", "aria-hidden": "true" }, "✓") : null,
              ),
              h("div", { class: "ft-media-badge" }, item.kind),
              h(
                "div",
                { class: "ft-media-caption" },
                item.kind === "video" && item.durationMs != null
                  ? h("span", { class: "ft-media-duration" }, msToClock(item.durationMs))
                  : null,
                h("span", { class: "ft-media-size" }, formatBytes(item.sizeBytes)),
              ),
            )
          }),
        )
      : h("div", { class: "ft-media-empty" }, "No captures yet"),
    h(
      "div",
      { class: "ft-media-actions" },
      h(SecondaryButton, { label: "Capture now", onClick: onCaptureNow }),
      h(SecondaryButton, { label: "Record now", onClick: onRecordNow }),
    ),
    errors.length > 0
      ? h("div", { class: "ft-media-error" }, ...errors.map((m) => h("div", { key: m }, m)))
      : null,
  )
}
