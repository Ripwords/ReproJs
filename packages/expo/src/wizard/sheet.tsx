import { useEffect, useMemo, useRef, useState } from "react"
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  Text,
  View,
} from "react-native"
import { GestureHandlerRootView } from "react-native-gesture-handler"
import { FlattenView, type FlattenHandle } from "../capture/flatten"
import { StepForm } from "./step-form"
import { StepAnnotate } from "./step-annotate"
import { StepSubmit, type SummaryLine } from "./step-submit"
import { createAnnotationStore } from "../annotation/store"
import { useAnnotationShapes } from "../annotation/use-shapes"
import { CloseIcon } from "../annotation/icons"
import { PrimaryButton, SecondaryButton, StepIndicator } from "./controls"
import { theme } from "./theme"
import { pickFromFiles, pickFromPhotos } from "../capture/file-picker"
import { SourcePicker, type AttachmentSource } from "./source-picker"
import { DEFAULT_ATTACHMENT_LIMITS, validateAttachments, type Attachment } from "@reprojs/sdk-utils"

export interface WizardArgs {
  initialTitle?: string
  initialDescription?: string
  screenshot: { uri: string; width: number; height: number } | null
  onSubmit: (result: {
    title: string
    description: string
    annotatedUri: string | null
    rawUri: string | null
    attachments: Attachment[]
  }) => Promise<void>
  onClose: () => void
}

const STEPS = ["Details", "Annotate", "Review"] as const
type Step = "form" | "annotate" | "submit"
const STEP_INDEX: Record<Step, number> = { form: 0, annotate: 1, submit: 2 }

export function WizardSheet({
  initialTitle,
  initialDescription,
  screenshot,
  onSubmit,
  onClose,
}: WizardArgs) {
  const [step, setStep] = useState<Step>("form")
  const [title, setTitle] = useState(initialTitle ?? "")
  const [description, setDescription] = useState(initialDescription ?? "")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [annotateSize, setAnnotateSize] = useState({ w: 0, h: 0 })
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [attachmentErrors, setAttachmentErrors] = useState<string[]>([])
  const [sourcePickerVisible, setSourcePickerVisible] = useState(false)
  const store = useRef(createAnnotationStore()).current
  const flattenRef = useRef<FlattenHandle | null>(null)

  // Subscribe so the offscreen FlattenView re-renders whenever shapes change.
  const shapes = useAnnotationShapes(store)

  useEffect(() => {
    setStep("form")
  }, [screenshot])

  function handleAttachmentsAdd() {
    setSourcePickerVisible(true)
  }

  async function handleSourceSelected(source: AttachmentSource) {
    setSourcePickerVisible(false)
    let picked: Attachment[] = []
    if (source === "files") picked = await pickFromFiles({ multiple: true })
    else if (source === "photos") picked = await pickFromPhotos({ multiple: true })
    if (picked.length === 0) return

    // Validate using a duck-typed candidate shape — RN's Blob polyfill
    // rejects ArrayBuffer parts, so we cannot synthesise File objects
    // here. The validator only reads name/size/type from candidates.
    const result = validateAttachments(
      picked.map((a) => ({ name: a.filename, size: a.size, type: a.mime })),
      attachments,
      DEFAULT_ATTACHMENT_LIMITS,
    )
    // Reattach the real picker output onto the validated Attachments. We
    // pair by index because filenames can collide (two screenshots from
    // the camera roll often share a name).
    const accepted = result.accepted.map((a, i) => {
      const original = picked[i]
      if (!original) return a
      return { ...a, blob: original.blob, previewUrl: original.previewUrl }
    })
    setAttachments((prev) => [...prev, ...accepted])
    setAttachmentErrors(result.rejected.map((r) => `${r.filename}: ${r.reason.replace(/-/g, " ")}`))
  }

  function handleAttachmentRemove(id: string) {
    setAttachments((prev) => prev.filter((a) => a.id !== id))
  }

  async function handleSubmit() {
    setSubmitting(true)
    setError(null)
    try {
      let annotated: string | null = null
      if (
        screenshot &&
        shapes.length > 0 &&
        flattenRef.current &&
        annotateSize.w > 0 &&
        annotateSize.h > 0
      ) {
        try {
          const flat = await flattenRef.current.flatten()
          annotated = flat.uri
        } catch {
          annotated = null
        }
      }
      await onSubmit({
        title,
        description,
        annotatedUri: annotated,
        rawUri: screenshot?.uri ?? null,
        attachments,
      })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  const currentIndex = STEP_INDEX[step]
  const titleEmpty = title.trim().length === 0

  const primaryLabel = useMemo(() => {
    if (step === "submit") return submitting ? "Sending…" : "Send report"
    return "Continue"
  }, [step, submitting])

  const primaryDisabled = (step === "form" && titleEmpty) || (step === "submit" && submitting)

  function handlePrimary() {
    if (step === "form") setStep("annotate")
    else if (step === "annotate") setStep("submit")
    else handleSubmit()
  }

  function handleBack() {
    if (step === "submit") setStep("annotate")
    else if (step === "annotate") setStep("form")
  }

  const summary: SummaryLine[] = useMemo(() => {
    const lines: SummaryLine[] = []
    if (title.trim()) lines.push({ label: "Title & description" })
    if (screenshot) {
      lines.push({
        label: shapes.length > 0 ? "Annotated screenshot" : "Screenshot",
        hint: shapes.length > 0 ? String(shapes.length) : undefined,
      })
    }
    lines.push({ label: "Console, network & breadcrumbs" })
    lines.push({ label: "Device & environment info" })
    if (attachments.length > 0) {
      lines.push({
        label: "Additional attachments",
        hint: String(attachments.length),
      })
    }
    return lines
  }, [title, screenshot, shapes.length, attachments.length])

  return (
    <Modal visible animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      {/* On Android a Modal is a separate native window (a Dialog) that sits
          outside the host app's GestureHandlerRootView, so gesture-handler
          receives no touches inside it and the annotation canvas cannot be
          drawn on. Gesture-handler detects this case and activates a nested
          root, so the wizard has to carry its own. iOS attaches recognizers to
          the views directly and never needed this. */}
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaView style={{ flex: 1, backgroundColor: theme.color.bg }}>
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : "height"}
            style={{ flex: 1 }}
          >
            {/* Header */}
            <View style={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: 18 }}>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <View style={{ gap: 2 }}>
                  <Text
                    style={{
                      fontSize: 10,
                      fontWeight: "700",
                      letterSpacing: 1.4,
                      color: theme.color.primary,
                      textTransform: "uppercase",
                    }}
                  >
                    Repro
                  </Text>
                  <Text
                    style={{
                      fontSize: 20,
                      fontWeight: "700",
                      color: theme.color.text,
                      letterSpacing: -0.3,
                    }}
                  >
                    Report a bug
                  </Text>
                </View>
                <Pressable
                  onPress={onClose}
                  hitSlop={12}
                  style={({ pressed }) => ({
                    width: 36,
                    height: 36,
                    borderRadius: 18,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: theme.color.surface,
                    opacity: pressed ? 0.6 : 1,
                  })}
                  accessibilityLabel="Close"
                  accessibilityRole="button"
                >
                  <CloseIcon size={14} color={theme.color.textMuted} />
                </Pressable>
              </View>
              <StepIndicator steps={STEPS} current={currentIndex} />
            </View>
            <View style={{ height: 1, backgroundColor: theme.color.border }} />

            {/* Body */}
            {step === "form" && (
              <StepForm
                title={title}
                description={description}
                attachments={attachments}
                attachmentErrors={attachmentErrors}
                onTitleChange={setTitle}
                onDescriptionChange={setDescription}
                onAttachmentsAdd={handleAttachmentsAdd}
                onAttachmentRemove={handleAttachmentRemove}
              />
            )}
            {step === "annotate" && (
              <StepAnnotate
                imageUri={screenshot?.uri ?? null}
                store={store}
                onSizeChange={setAnnotateSize}
              />
            )}
            {step === "submit" && <StepSubmit error={error} summary={summary} />}

            {/* Offscreen flatten — always mounted when we have a screenshot and
              measurement so flatten() can run from any step. */}
            {screenshot && annotateSize.w > 0 && annotateSize.h > 0 && (
              <FlattenView
                ref={flattenRef}
                uri={screenshot.uri}
                width={annotateSize.w}
                height={annotateSize.h}
                shapes={shapes}
              />
            )}

            {/* Footer */}
            <View
              style={{
                paddingHorizontal: 20,
                paddingTop: 14,
                paddingBottom: Platform.OS === "ios" ? 14 : 18,
                borderTopWidth: 1,
                borderTopColor: theme.color.border,
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                backgroundColor: theme.color.bg,
              }}
            >
              {step !== "form" ? (
                <SecondaryButton label="Back" onPress={handleBack} disabled={submitting} />
              ) : null}
              <View style={{ flex: 1 }}>
                <PrimaryButton
                  label={primaryLabel}
                  onPress={handlePrimary}
                  disabled={primaryDisabled}
                  loading={submitting}
                />
              </View>
            </View>
          </KeyboardAvoidingView>
        </SafeAreaView>
        <SourcePicker
          visible={sourcePickerVisible}
          onSelect={handleSourceSelected}
          onCancel={() => setSourcePickerVisible(false)}
        />
      </GestureHandlerRootView>
    </Modal>
  )
}
