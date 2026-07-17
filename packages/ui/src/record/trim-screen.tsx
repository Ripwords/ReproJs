import { h } from "preact"
import { useEffect, useRef, useState } from "preact/hooks"
import type { TrimRange } from "@reprojs/sdk-utils"
import { PrimaryButton, SecondaryButton } from "../wizard/controls"

interface TrimScreenProps {
  blob: Blob
  durationMs: number
  initial?: TrimRange
  onConfirm: (trim: TrimRange | undefined) => void
  onCancel: () => void
}

function snap(n: number): number {
  return Math.round(n / 100) * 100
}

/** Clamps a candidate trim range into [0, durationMs], snaps both edges to
 * the nearest 100ms, guarantees at least 100ms of clip remains, and collapses
 * to `undefined` when the (snapped) range covers the full clip — the caller
 * treats `undefined` as "no trim, use the full recording". */
export function clampTrim(
  t: { startMs: number; endMs: number },
  durationMs: number,
): TrimRange | undefined {
  const start = Math.min(Math.max(0, snap(t.startMs)), durationMs)
  let end = Math.min(Math.max(0, snap(t.endMs)), durationMs)
  if (end - start < 100) end = Math.min(durationMs, start + 100)
  // Degenerate: both handles pinned at the clip end (duration an exact multiple
  // of 100) leaves no room for the min-100ms bump, so start === end. Treat a
  // non-positive-length range as "no trim" rather than persisting an empty one.
  if (start >= end) return undefined
  if (start <= 0 && end >= durationMs) return undefined
  return { startMs: start, endMs: end }
}

function msToClock(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  const centis = Math.floor((ms % 1000) / 100)
  return `${minutes}:${String(seconds).padStart(2, "0")}.${centis}`
}

export function TrimScreen({ blob, durationMs, initial, onConfirm, onCancel }: TrimScreenProps) {
  const [startMs, setStartMs] = useState(initial?.startMs ?? 0)
  const [endMs, setEndMs] = useState(initial?.endMs ?? durationMs)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [previewFailed, setPreviewFailed] = useState(false)
  const urlRef = useRef<string | null>(null)

  useEffect(() => {
    try {
      const url = URL.createObjectURL(blob)
      urlRef.current = url
      setVideoUrl(url)
    } catch {
      setPreviewFailed(true)
    }
    return () => {
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current)
        urlRef.current = null
      }
    }
  }, [blob])

  function handleStartChange(value: number) {
    setStartMs(Math.max(0, Math.min(value, endMs)))
  }

  function handleEndChange(value: number) {
    setEndMs(Math.max(startMs, Math.min(value, durationMs)))
  }

  function handleConfirm() {
    onConfirm(clampTrim({ startMs, endMs }, durationMs))
  }

  return h(
    "div",
    { class: "ft-trim" },
    previewFailed
      ? h(
          "div",
          { class: "ft-trim-fallback" },
          "Preview unavailable on this site — the recording is intact",
        )
      : h("video", {
          class: "ft-trim-video",
          src: videoUrl ?? undefined,
          controls: true,
          onError: () => setPreviewFailed(true),
        }),
    h(
      "div",
      { class: "ft-trim-controls" },
      h(
        "div",
        { class: "ft-trim-row" },
        h("span", { class: "ft-trim-label" }, "Start"),
        h("input", {
          type: "range",
          class: "ft-trim-slider",
          min: 0,
          max: durationMs,
          step: 100,
          value: startMs,
          onInput: (e: Event) => handleStartChange(Number((e.target as HTMLInputElement).value)),
        }),
        h("span", { class: "ft-trim-clock" }, msToClock(startMs)),
      ),
      h(
        "div",
        { class: "ft-trim-row" },
        h("span", { class: "ft-trim-label" }, "End"),
        h("input", {
          type: "range",
          class: "ft-trim-slider",
          min: 0,
          max: durationMs,
          step: 100,
          value: endMs,
          onInput: (e: Event) => handleEndChange(Number((e.target as HTMLInputElement).value)),
        }),
        h("span", { class: "ft-trim-clock" }, msToClock(endMs)),
      ),
    ),
    h(
      "div",
      { class: "ft-trim-footer" },
      h(SecondaryButton, { label: "Cancel", onClick: onCancel }),
      h(PrimaryButton, { label: "Confirm", onClick: handleConfirm }),
    ),
  )
}
