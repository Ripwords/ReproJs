import { h } from "preact"
import { useEffect, useRef } from "preact/hooks"
import { Canvas } from "../annotation/canvas"
import { flatten } from "../annotation/flatten"
import { DEFAULT_SHORTCUTS, registerShortcuts, type Action } from "../annotation/shortcuts"
import { clear, redo, shapes, tool, undo, viewport } from "../annotation/store"
import { ToolPicker } from "../annotation/tool-picker"
import type { Tool } from "@reprojs/sdk-utils"
import { fitTransform } from "../annotation/viewport"
import { sourceHeight, sourceWidth, type ImageSource } from "../decode-image"
import { PrimaryButton, SecondaryButton, WizardHeader } from "./controls"

interface Props {
  bg: ImageSource
  steps: readonly string[]
  currentStep: number
  onSkip: () => void
  onNext: (annotatedBlob: Blob) => void
  onCancel: () => void
}

export function StepAnnotate({ bg, steps, currentStep, onSkip, onNext, onCancel }: Props) {
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const dispatch = (action: Action) => {
      switch (action) {
        case "tool.arrow":
        case "tool.rect":
        case "tool.pen":
        case "tool.highlight":
        case "tool.text":
          tool.value = action.split(".")[1] as Tool
          return
        case "undo":
          undo()
          return
        case "redo":
          redo()
          return
        case "clear":
          if (shapes.value.length > 0 && confirm("Clear all annotations?")) clear()
          return
        case "cancel.draft":
          return
        case "resetView": {
          viewport.value = fitTransform(
            sourceWidth(bg),
            sourceHeight(bg),
            window.innerWidth,
            window.innerHeight,
          )
          return
        }
      }
    }
    // getRootNode() resolves the closed ShadowRoot the widget is mounted in
    // (fallback to document for a light-DOM mount). The window listener needs
    // it to detect focus inside the annotation <textarea> — see isInsideInput.
    const root = (rootRef.current?.getRootNode() as DocumentOrShadowRoot | undefined) ?? document
    const dispose = registerShortcuts(window, DEFAULT_SHORTCUTS, dispatch, root)
    return () => dispose()
  }, [bg])

  async function handleNext() {
    const blob = await flatten(bg, shapes.value)
    onNext(blob)
  }

  function handleClose() {
    if (shapes.value.length > 0 && !confirm("Discard annotations?")) return
    onCancel()
  }

  return h(
    "div",
    { class: "ft-wizard", ref: rootRef },
    h(WizardHeader, {
      eyebrow: "Repro",
      title: "Report a bug",
      steps,
      current: currentStep,
      onClose: handleClose,
    }),
    h("div", { class: "ft-wizard-body ft-wizard-annotate" }, h(Canvas, { bg })),
    h(
      "footer",
      { class: "ft-wizard-footer" },
      h(ToolPicker, null),
      h(
        "div",
        { style: { display: "flex", gap: "8px" } },
        h(SecondaryButton, { label: "Skip", onClick: onSkip }),
        h(PrimaryButton, { label: "Continue", onClick: handleNext }),
      ),
    ),
  )
}
