import { h } from "preact"
import { useEffect, useMemo, useRef, useState } from "preact/hooks"
import { reset, shapes } from "./annotation/store"
import { closeSource, decodeImage, type ImageSource } from "./decode-image"
import { DEFAULT_ATTACHMENT_LIMITS, validateAttachments, type Attachment } from "@reprojs/sdk-utils"
import { StepAnnotate } from "./wizard/step-annotate"
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
  onCapture: () => Promise<Blob | null>
  onSubmit: (payload: {
    title: string
    description: string
    screenshot: Blob | null
    attachments: Attachment[]
    dwellMs: number
    honeypot: string
  }) => Promise<ReporterSubmitResult>
  openedAt: number
}

const STEPS = ["Annotate", "Details", "Review"] as const
type StepName = "annotate" | "details" | "review"
const STEP_INDEX: Record<StepName, number> = { annotate: 0, details: 1, review: 2 }

export function Reporter({ onClose, onCapture, onSubmit, openedAt }: ReporterProps) {
  const [bg, setBg] = useState<ImageSource | null>(null)
  const [annotatedBlob, setAnnotatedBlob] = useState<Blob | null>(null)
  const [rawScreenshot, setRawScreenshot] = useState<Blob | null>(null)
  const [step, setStep] = useState<StepName>("annotate")
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const hpRef = useRef<HTMLInputElement>(null)
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [attachmentErrors, setAttachmentErrors] = useState<string[]>([])
  useEffect(() => {
    let cancelled = false
    let decoded: ImageSource | null = null
    ;(async () => {
      const blob = await onCapture()
      if (!blob) {
        if (!cancelled) onClose()
        return
      }
      setRawScreenshot(blob)
      // Decode without minting a blob: URL — host pages whose CSP omits
      // `blob:` from img-src would refuse to load it. See decode-image.ts.
      decoded = await decodeImage(blob)
      if (cancelled) {
        closeSource(decoded)
        return
      }
      if (!decoded) {
        // Never leave the wizard gated on a screenshot that will never
        // arrive — the loading overlay would hang with the page scroll
        // locked behind it.
        console.warn("[repro] could not decode the screenshot; closing the reporter")
        onClose()
        return
      }
      setBg(decoded)
    })()
    return () => {
      cancelled = true
      closeSource(decoded)
      reset()
    }
  }, [])

  useEffect(() => {
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = ""
    }
  }, [])

  function handleNextFromAnnotate(blob: Blob) {
    setAnnotatedBlob(blob)
    setStep("details")
  }
  function handleSkipFromAnnotate() {
    setAnnotatedBlob(rawScreenshot)
    setStep("details")
  }
  function handleBack() {
    if (step === "review") setStep("details")
    else if (step === "details") setStep("annotate")
  }
  function handleContinueFromDetails() {
    setStep("review")
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
    const res = await onSubmit({
      title: title.trim(),
      description: description.trim(),
      screenshot: annotatedBlob,
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
    if (annotatedBlob) {
      lines.push({
        label: shapes.value.length > 0 ? "Annotated screenshot" : "Screenshot",
        hint: shapes.value.length > 0 ? String(shapes.value.length) : undefined,
      })
    }
    lines.push({ label: "Console, network & breadcrumbs" })
    lines.push({ label: "Environment info" })
    if (attachments.length > 0) {
      lines.push({ label: "Additional attachments", hint: String(attachments.length) })
    }
    return lines
  }, [annotatedBlob, attachments.length])

  if (!bg) {
    return h("div", { class: "ft-wizard-loading" }, "Capturing…")
  }

  if (step === "annotate") {
    return h(StepAnnotate, {
      bg,
      steps: STEPS,
      currentStep: STEP_INDEX.annotate,
      onSkip: handleSkipFromAnnotate,
      onNext: handleNextFromAnnotate,
      onCancel: onClose,
    })
  }

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
          annotatedBlob,
          onTitleChange: setTitle,
          onDescriptionChange: setDescription,
          onAttachmentsAdd: handleAttachmentsAdd,
          onAttachmentRemove: handleAttachmentRemove,
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
      h(SecondaryButton, { label: "Back", onClick: handleBack, disabled: submitting }),
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
