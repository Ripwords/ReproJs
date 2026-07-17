import { h } from "preact"
import { useRef, useState } from "preact/hooks"
import { BlobImage } from "../blob-image"
import { formatBytes, type Attachment, type AttachmentLimits } from "@reprojs/sdk-utils"

interface Props {
  attachments: Attachment[]
  limits: AttachmentLimits
  errors?: string[]
  onAdd: (files: File[]) => void
  onRemove: (id: string) => void
}

function isMacLike(): boolean {
  if (typeof navigator === "undefined") return false
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform)
}

export function AttachmentList({ attachments, limits, errors, onAdd, onRemove }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const totalBytes = attachments.reduce((n, a) => n + a.size, 0)
  const atCap = attachments.length >= limits.maxCount
  const shortcut = isMacLike() ? "⌘V" : "Ctrl+V"

  function openPicker() {
    if (atCap) return
    fileInputRef.current?.click()
  }

  function handleChange(e: Event) {
    const target = e.target as HTMLInputElement
    const files = target.files ? Array.from(target.files) : []
    if (files.length > 0) onAdd(files)
    target.value = ""
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault()
    if (atCap) return
    if (!dragOver) setDragOver(true)
  }
  function handleDragLeave() {
    setDragOver(false)
  }
  function handleDrop(e: DragEvent) {
    e.preventDefault()
    setDragOver(false)
    if (atCap) return
    const files = e.dataTransfer ? Array.from(e.dataTransfer.files) : []
    if (files.length > 0) onAdd(files)
  }

  return h(
    "div",
    { class: "ft-attach" },
    attachments.length > 0
      ? h(
          "div",
          { class: "ft-attach-grid" },
          ...attachments.map((a) =>
            h(
              "div",
              { class: "ft-attach-item", key: a.id },
              h(
                "button",
                {
                  type: "button",
                  class: "ft-attach-remove",
                  onClick: () => onRemove(a.id),
                  "aria-label": `Remove ${a.filename}`,
                },
                "✕",
              ),
              a.isImage
                ? h(BlobImage, { class: "ft-attach-thumb", blob: a.blob, alt: a.filename })
                : h("div", { class: "ft-attach-icon" }, "📄"),
              h("div", { class: "ft-attach-name", title: a.filename }, a.filename),
              h("div", { class: "ft-attach-meta" }, formatBytes(a.size)),
            ),
          ),
        )
      : null,
    h(
      "button",
      {
        type: "button",
        class: "ft-attach-dropzone",
        disabled: atCap,
        "data-dragover": dragOver ? "true" : "false",
        onClick: openPicker,
        onDragOver: handleDragOver,
        onDragEnter: handleDragOver,
        onDragLeave: handleDragLeave,
        onDrop: handleDrop,
      },
      atCap
        ? h(
            "span",
            null,
            `${attachments.length} of ${limits.maxCount} attached — remove one to add more`,
          )
        : h(
            "span",
            null,
            "Click to add files, drop them here, or paste ",
            h("span", { class: "ft-attach-dropzone-shortcut" }, shortcut),
          ),
    ),
    h(
      "div",
      { class: "ft-attach-status" },
      `${attachments.length} / ${limits.maxCount} · ${formatBytes(totalBytes)}`,
    ),
    h("input", {
      ref: fileInputRef,
      type: "file",
      multiple: true,
      style: { display: "none" },
      onChange: handleChange,
    }),
    errors && errors.length > 0
      ? h("div", { class: "ft-attach-error" }, ...errors.map((m) => h("div", { key: m }, m)))
      : null,
  )
}
