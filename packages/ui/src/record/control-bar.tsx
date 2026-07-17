import { h } from "preact"

interface RecordControlBarProps {
  elapsedMs: number
  maxMs: number
  onStop: () => void
  onCancel: () => void
}

function msToClock(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, "0")}`
}

export function RecordControlBar({ elapsedMs, maxMs, onStop, onCancel }: RecordControlBarProps) {
  return h(
    "div",
    { class: "ft-rec-bar" },
    h("span", { class: "ft-rec-dot" }),
    h("span", { class: "ft-rec-time" }, `${msToClock(elapsedMs)} / ${msToClock(maxMs)}`),
    h("button", { type: "button", class: "ft-rec-stop", onClick: onStop }, "Stop"),
    h("button", { type: "button", class: "ft-rec-cancel", onClick: onCancel }, "Cancel"),
  )
}
