import { h } from "preact"
import { useEffect, useMemo, useRef, useState } from "preact/hooks"
import {
  DEFAULT_ATTACHMENT_LIMITS,
  validateAttachments,
  validateMediaSelection,
  type Attachment,
} from "@reprojs/sdk-utils"
import type { GalleryItem, GalleryStore } from "./gallery/store"
import { StepDetails } from "./wizard/step-details"
import { StepReview, type SummaryLine } from "./wizard/step-review"
import { SubmitToast } from "./wizard/submit-toast"
import { PrimaryButton, SecondaryButton, WizardHeader } from "./wizard/controls"

export interface ReporterSubmitResult {
  ok: boolean
  message?: string
}

interface ReporterProps {
  onClose: () => void
  onSubmit: (payload: {
    title: string
    description: string
    media: GalleryItem[]
    attachments: Attachment[]
    dwellMs: number
    honeypot: string
  }) => Promise<ReporterSubmitResult>
  openedAt: number
  gallery: GalleryStore | null
  preselectedId?: string
  onCaptureNow: () => void
  onRecordNow: () => void
}

const STEPS = ["Details", "Review"] as const
type StepName = "details" | "review"
const STEP_INDEX: Record<StepName, number> = { details: 0, review: 1 }

export function Reporter({
  onClose,
  onSubmit,
  openedAt,
  gallery,
  preselectedId,
  onCaptureNow,
  onRecordNow,
}: ReporterProps) {
  const [step, setStep] = useState<StepName>("details")
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const hpRef = useRef<HTMLInputElement>(null)
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [attachmentErrors, setAttachmentErrors] = useState<string[]>([])
  const [mediaItems, setMediaItems] = useState<GalleryItem[]>([])
  const [selectedMediaIds, setSelectedMediaIds] = useState<string[]>(() =>
    preselectedId ? [preselectedId] : [],
  )
  const [mediaErrors, setMediaErrors] = useState<string[]>([])

  // Gallery may be null (IndexedDB unavailable) — fail open by leaving
  // mediaItems empty rather than throwing. The picker hides its grid but
  // keeps the Capture now / Record now buttons visible either way.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const items = (await gallery?.list()) ?? []
      if (!cancelled) setMediaItems(items)
    })()
    return () => {
      cancelled = true
    }
  }, [gallery])

  useEffect(() => {
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = ""
    }
  }, [])

  function handleBack() {
    if (step === "review") setStep("details")
  }
  function handleContinueFromDetails() {
    setStep("review")
  }

  // Runs validateMediaSelection on the would-be selection (not the current
  // one) so an over-limit toggle is rejected outright — the selection never
  // transiently exceeds the limit. Deselecting always shrinks the set, so it
  // can never be blocked; that's how a later valid toggle clears mediaErrors.
  function handleMediaToggle(id: string) {
    const isSelected = selectedMediaIds.includes(id)
    const nextIds = isSelected
      ? selectedMediaIds.filter((selectedId) => selectedId !== id)
      : [...selectedMediaIds, id]
    const chosen = mediaItems.filter((item) => nextIds.includes(item.id))
    const result = validateMediaSelection(
      chosen.map((item) => ({ kind: item.kind, sizeBytes: item.sizeBytes })),
    )
    if (!result.ok) {
      setMediaErrors(result.errors)
      return
    }
    setMediaErrors([])
    setSelectedMediaIds(nextIds)
  }

  function handleAttachmentsAdd(files: File[]) {
    const result = validateAttachments(files, attachments, DEFAULT_ATTACHMENT_LIMITS)
    if (result.accepted.length > 0) {
      // No previewUrl on web: thumbnails render straight from the blob via
      // BlobImage, since a blob: URL in <img src> is refused by host CSPs
      // that omit `blob:` from img-src. (The Expo SDK still populates
      // previewUrl with a file:// uri — see @reprojs/expo provider.)
      setAttachments((prev) => [...prev, ...result.accepted])
    }
    if (result.rejected.length > 0) {
      setAttachmentErrors(
        result.rejected.map(
          (r) =>
            `${r.filename}: ${
              r.reason === "too-large"
                ? "too large"
                : r.reason === "denied-mime"
                  ? "file type not allowed"
                  : r.reason === "count-exceeded"
                    ? "too many files (max 5)"
                    : r.reason === "total-exceeded"
                      ? "total budget exceeded"
                      : "couldn't read file"
            }`,
        ),
      )
    } else {
      setAttachmentErrors([])
    }
  }

  function handleAttachmentRemove(id: string) {
    setAttachments((prev) => prev.filter((a) => a.id !== id))
  }

  // Paste-to-attach: while the user is on the Details step, intercept paste
  // events that carry image data (e.g. a screenshot copied to clipboard) and
  // route them into the attachment list. Plain-text pastes (into the title /
  // description fields) carry no image items, so they pass through unchanged.
  useEffect(() => {
    if (step !== "details") return undefined
    function onPaste(e: ClipboardEvent) {
      const items = e.clipboardData?.items
      if (!items) return
      const images: File[] = []
      for (const item of items) {
        if (item.kind === "file" && item.type.startsWith("image/")) {
          const f = item.getAsFile()
          if (!f) continue
          // Clipboard images often arrive as `image.png` with no useful name.
          // Stamp a unique name so multiple pastes don't appear identical and
          // so the server's storage key is distinguishable.
          const ext = (item.type.split("/")[1] ?? "png").toLowerCase()
          const renamed = new File([f], `pasted-${Date.now()}.${ext}`, { type: item.type })
          images.push(renamed)
        }
      }
      if (images.length === 0) return
      e.preventDefault()
      handleAttachmentsAdd(images)
    }
    document.addEventListener("paste", onPaste)
    return () => document.removeEventListener("paste", onPaste)
  }, [step, attachments])

  async function handleSend() {
    if (!title.trim() || submitting || success) return
    setSubmitting(true)
    setSubmitError(null)
    const media = mediaItems.filter((item) => selectedMediaIds.includes(item.id))
    const res = await onSubmit({
      title: title.trim(),
      description: description.trim(),
      media,
      attachments,
      dwellMs: Math.max(0, Math.round(performance.now() - openedAt)),
      honeypot: hpRef.current?.value ?? "",
    })
    setSubmitting(false)
    if (res.ok) {
      setSuccess(true)
      setTimeout(onClose, 1500)
    } else {
      setSubmitError(res.message ?? "Something went wrong.")
    }
  }

  const summary = useMemo<SummaryLine[]>(() => {
    const lines: SummaryLine[] = [{ label: "Title & description" }]
    if (selectedMediaIds.length > 0) {
      lines.push({ label: "Media", hint: `${selectedMediaIds.length} selected` })
    }
    lines.push({ label: "Console, network & breadcrumbs" })
    lines.push({ label: "Environment info" })
    if (attachments.length > 0) {
      lines.push({ label: "Additional attachments", hint: String(attachments.length) })
    }
    return lines
  }, [selectedMediaIds, attachments.length])

  const headerProps = {
    eyebrow: "Repro",
    title: "Report a bug",
    steps: STEPS,
    current: STEP_INDEX[step],
    onClose,
  }

  const body =
    step === "details"
      ? h(StepDetails, {
          title,
          description,
          attachments,
          attachmentErrors,
          mediaItems,
          selectedMediaIds,
          mediaErrors,
          onTitleChange: setTitle,
          onDescriptionChange: setDescription,
          onAttachmentsAdd: handleAttachmentsAdd,
          onAttachmentRemove: handleAttachmentRemove,
          onMediaToggle: handleMediaToggle,
          onCaptureNow,
          onRecordNow,
        })
      : h(StepReview, { summary, error: success ? null : submitError })

  const primary =
    step === "details"
      ? h(PrimaryButton, {
          label: "Continue",
          onClick: handleContinueFromDetails,
          disabled: !title.trim(),
        })
      : h(PrimaryButton, {
          label: success ? "Sent" : "Send report",
          onClick: handleSend,
          disabled: !title.trim() || success,
          loading: submitting,
        })

  return h(
    "div",
    { class: "ft-wizard" },
    h(WizardHeader, headerProps),
    body,
    h(SubmitToast, { visible: submitting, attachmentCount: attachments.length }),
    h(
      "footer",
      { class: "ft-wizard-footer" },
      h(SecondaryButton, {
        label: "Back",
        onClick: handleBack,
        disabled: submitting || step === "details",
      }),
      h("input", {
        ref: hpRef,
        name: "website",
        type: "text",
        tabIndex: -1,
        autoComplete: "off",
        "aria-hidden": "true",
        style: {
          position: "absolute",
          left: "-9999px",
          top: "-9999px",
          width: 1,
          height: 1,
          opacity: 0,
          pointerEvents: "none",
        },
      }),
      primary,
    ),
  )
}
