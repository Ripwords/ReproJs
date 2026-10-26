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

export interface RelatedIssueField {
  value: string
  // Inline hint shown under the input while the text is not an issue
  // reference; null when the field is empty or parses.
  error: string | null
  onChange: (v: string) => void
}

interface Props {
  title: string
  description: string
  // Present only when the host enabled fields.relatedIssue — the input is
  // otherwise not rendered at all.
  relatedIssue?: RelatedIssueField | undefined
  attachments: Attachment[]
  attachmentErrors: string[]
  mediaItems: GalleryItem[]
  selectedMediaIds: string[]
  mediaErrors: string[]
  onBrowseGallery?: (() => void) | undefined
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
  relatedIssue,
  attachments,
  attachmentErrors,
  mediaItems,
  selectedMediaIds,
  mediaErrors,
  onBrowseGallery,
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
      relatedIssue
        ? h(
            "div",
            { class: "ft-field" },
            h(FieldLabel, { label: "Related GitHub issue", optional: true }),
            h("input", {
              type: "text",
              value: relatedIssue.value,
              maxLength: 300,
              placeholder: "#123 or issue URL",
              autoComplete: "off",
              spellcheck: false,
              "aria-invalid": relatedIssue.error ? "true" : undefined,
              onInput: (e: Event) => relatedIssue.onChange((e.target as HTMLInputElement).value),
            }),
            relatedIssue.error ? h("div", { class: "ft-field-error" }, relatedIssue.error) : null,
          )
        : null,
      h(
        "div",
        { class: "ft-field" },
        h(FieldLabel, { label: "Media", optional: true }),
        h(MediaPicker, {
          items: mediaItems,
          selectedIds: selectedMediaIds,
          errors: mediaErrors,
          onBrowseGallery,
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
