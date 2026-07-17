// packages/ui/src/capture-flow.tsx
import { h } from "preact"
import { useEffect, useState } from "preact/hooks"
import type { TrimRange } from "@reprojs/sdk-utils"
import { BlobImage } from "./blob-image"
import { closeSource, decodeImage, type ImageSource } from "./decode-image"
import { OutcomeBar } from "./record/outcome-bar"
import { StepAnnotate } from "./wizard/step-annotate"

export interface PendingMediaItem {
  kind: "image" | "video"
  blob: Blob
  mime: string
  durationMs?: number
  trim?: TrimRange
}

type CaptureOutcome =
  | { action: "saved"; item: PendingMediaItem }
  | { action: "discarded" }
  | { action: "report"; item: PendingMediaItem }

interface CaptureFlowProps {
  onCapture: () => Promise<Blob | null>
  onDone: (outcome: CaptureOutcome) => void
}

type Stage =
  | { kind: "capturing" }
  | { kind: "annotate"; bg: ImageSource; raw: Blob }
  | { kind: "outcome"; blob: Blob }

function buildItem(blob: Blob): PendingMediaItem {
  return { kind: "image", blob, mime: blob.type || "image/png" }
}

// capture -> annotate -> outcome. Mirrors Reporter's capture/decode
// bootstrap (reporter.tsx): a denied capture dialog resolves the capture
// promise with null and must exit silently — never surface an error — and a
// screenshot that fails to decode must not leave the flow stranded either.
export function CaptureFlow({ onCapture, onDone }: CaptureFlowProps) {
  const [stage, setStage] = useState<Stage>({ kind: "capturing" })

  useEffect(() => {
    let cancelled = false
    let decoded: ImageSource | null = null
    ;(async () => {
      const blob = await onCapture()
      if (!blob) {
        if (!cancelled) onDone({ action: "discarded" })
        return
      }
      decoded = await decodeImage(blob)
      if (cancelled) {
        closeSource(decoded)
        return
      }
      if (!decoded) {
        onDone({ action: "discarded" })
        return
      }
      setStage({ kind: "annotate", bg: decoded, raw: blob })
    })()
    return () => {
      cancelled = true
      closeSource(decoded)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount, same as Reporter
  }, [])

  if (stage.kind === "capturing") {
    return h("div", { class: "ft-wizard-loading" }, "Capturing…")
  }

  if (stage.kind === "annotate") {
    const { bg, raw } = stage
    return h(StepAnnotate, {
      bg,
      steps: ["Annotate"],
      currentStep: 0,
      onSkip: () => setStage({ kind: "outcome", blob: raw }),
      onNext: (annotatedBlob: Blob) => setStage({ kind: "outcome", blob: annotatedBlob }),
      onCancel: () => onDone({ action: "discarded" }),
    })
  }

  const { blob } = stage
  return h(
    "div",
    { class: "ft-wizard ft-capture-outcome" },
    h(
      "div",
      { class: "ft-wizard-body ft-outcome-body" },
      h(BlobImage, { blob, alt: "Captured screenshot", class: "ft-outcome-preview" }),
    ),
    h(OutcomeBar, {
      kind: "image",
      onSave: () => onDone({ action: "saved", item: buildItem(blob) }),
      onDiscard: () => onDone({ action: "discarded" }),
      onReport: () => onDone({ action: "report", item: buildItem(blob) }),
    }),
  )
}
