import { h } from "preact"
import { FieldLabel } from "./controls"
import { AttachmentList } from "./attachment-list"
import { MediaPicker } from "./media-picker"
import type { GalleryItem } from "../gallery/store"
import {
  DEFAULT_ATTACHMENT_LIMITS,
  type Attachment,
  type AttachmentLimits,
} from "@reprojs/sdk-utils"

interface Props {
  title: string
  description: string
  attachments: Attachment[]
  attachmentErrors: string[]
  mediaItems: GalleryItem[]
  selectedMediaIds: string[]
  mediaErrors: string[]
  limits?: AttachmentLimits
  onTitleChange: (v: string) => void
  onDescriptionChange: (v: string) => void
  onAttachmentsAdd: (files: File[]) => void
  onAttachmentRemove: (id: string) => void
  onMediaToggle: (id: string) => void
  onCaptureNow: () => void
  onRecordNow: () => void
}

export function StepDetails({
  title,
  description,
  attachments,
  attachmentErrors,
  mediaItems,
  selectedMediaIds,
  mediaErrors,
  limits = DEFAULT_ATTACHMENT_LIMITS,
  onTitleChange,
  onDescriptionChange,
  onAttachmentsAdd,
  onAttachmentRemove,
  onMediaToggle,
  onCaptureNow,
  onRecordNow,
}: Props) {
  return h(
    "div",
    { class: "ft-wizard-body ft-wizard-step" },
    h(
      "div",
      { class: "ft-wizard-step-inner ft-wizard-details-form" },
      h(
        "div",
        { class: "ft-field" },
        h(FieldLabel, { label: "Title" }),
        h("input", {
          type: "text",
          value: title,
          maxLength: 120,
          placeholder: "What went wrong?",
          onInput: (e: Event) => onTitleChange((e.target as HTMLInputElement).value),
        }),
      ),
      h(
        "div",
        { class: "ft-field" },
        h(FieldLabel, { label: "Details", optional: true }),
        h("textarea", {
          value: description,
          maxLength: 10000,
          rows: 6,
          placeholder: "Steps to reproduce, expected vs actual…",
          onInput: (e: Event) => onDescriptionChange((e.target as HTMLTextAreaElement).value),
        }),
      ),
      h(
        "div",
        { class: "ft-field" },
        h(FieldLabel, { label: "Media", optional: true }),
        h(MediaPicker, {
          items: mediaItems,
          selectedIds: selectedMediaIds,
          errors: mediaErrors,
          onToggle: onMediaToggle,
          onCaptureNow,
          onRecordNow,
        }),
      ),
      h(
        "div",
        { class: "ft-field" },
        h(FieldLabel, { label: "Attachments", optional: true }),
        h(AttachmentList, {
          attachments,
          limits,
          errors: attachmentErrors,
          onAdd: onAttachmentsAdd,
          onRemove: onAttachmentRemove,
        }),
      ),
    ),
  )
}
