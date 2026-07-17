import { h } from "preact"
import { PrimaryButton, SecondaryButton } from "../wizard/controls"

interface OutcomeBarProps {
  kind: "image" | "video"
  onSave: () => void
  onDiscard: () => void
  onReport: () => void
}

export function OutcomeBar({ kind, onSave, onDiscard, onReport }: OutcomeBarProps) {
  return h(
    "div",
    { class: "ft-outcome-bar", "data-kind": kind },
    h("button", { type: "button", class: "ft-outcome-discard", onClick: onDiscard }, "Discard"),
    h(SecondaryButton, { label: "Save to gallery", onClick: onSave }),
    h(PrimaryButton, { label: "Report bug with this", onClick: onReport }),
  )
}
