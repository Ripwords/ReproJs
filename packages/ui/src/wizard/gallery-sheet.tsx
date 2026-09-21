import { h } from "preact"
import { useEffect, useState } from "preact/hooks"
import { formatBytes } from "@reprojs/sdk-utils"
import { BlobImage } from "../blob-image"
import type { GalleryItem, GalleryStore } from "../gallery/store"
import { PrimaryButton, SecondaryButton } from "./controls"

interface Props {
  store: GalleryStore
  // Items already on offer in the picker — a second copy would just be a
  // duplicate chip the user can't tell apart.
  excludeIds: string[]
  onAdd: (items: GalleryItem[]) => void
  onCancel: () => void
}

// Duplicated in media-picker.tsx / gallery-view.tsx / record/*.tsx rather than
// shared — same tiny-helper convention used across the wizard/gallery UI.
function msToClock(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, "0")}`
}

// The saved-media archive, on demand. It deliberately lives behind a button
// instead of inline in the Details step: the archive grows without bound (up
// to the store's 50-item cap), and rendering all of it next to the one
// screenshot the reporter just took buried the thing they actually meant to
// attach.
export function GallerySheet({ store, excludeIds, onAdd, onCancel }: Props) {
  const [items, setItems] = useState<GalleryItem[] | null>(null)
  const [chosen, setChosen] = useState<string[]>([])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      // A store read can reject (IndexedDB evicted mid-session, private-mode
      // quirks). Fail open to an empty archive — the picker's Capture now /
      // Record now path still works.
      const all = await store.list().catch(() => [] as GalleryItem[])
      if (!cancelled) setItems(all.filter((item) => !excludeIds.includes(item.id)))
    })()
    return () => {
      cancelled = true
    }
  }, [store])

  function toggle(id: string) {
    setChosen((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  function handleAdd() {
    if (!items) return
    onAdd(items.filter((item) => chosen.includes(item.id)))
  }

  const body =
    items === null
      ? h("div", { class: "ft-sheet-empty" }, "Loading…")
      : items.length === 0
        ? h(
            "div",
            { class: "ft-sheet-empty" },
            "Nothing saved yet. Captures land here only when you choose “Save to gallery”.",
          )
        : h(
            "div",
            { class: "ft-sheet-grid" },
            ...items.map((item) => {
              const selected = chosen.includes(item.id)
              return h(
                "button",
                {
                  type: "button",
                  class: `ft-sheet-item${selected ? " selected" : ""}`,
                  "aria-pressed": selected,
                  key: item.id,
                  onClick: () => toggle(item.id),
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
                  selected
                    ? h("div", { class: "ft-media-check", "aria-hidden": "true" }, "✓")
                    : null,
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

  return h(
    "div",
    { class: "ft-sheet-backdrop", onClick: onCancel },
    h(
      "div",
      {
        class: "ft-sheet",
        role: "dialog",
        "aria-label": "Choose from gallery",
        onClick: (e: Event) => e.stopPropagation(),
      },
      h("div", { class: "ft-sheet-head" }, "Saved media"),
      h("div", { class: "ft-sheet-body" }, body),
      h(
        "div",
        { class: "ft-sheet-footer" },
        h(SecondaryButton, { label: "Cancel", onClick: onCancel }),
        h(PrimaryButton, {
          label: chosen.length > 0 ? `Add ${chosen.length}` : "Add",
          onClick: handleAdd,
          disabled: chosen.length === 0,
        }),
      ),
    ),
  )
}
