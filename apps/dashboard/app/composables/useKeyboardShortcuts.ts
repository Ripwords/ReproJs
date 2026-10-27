import { onMounted, onBeforeUnmount } from "vue"

export interface ShortcutMap {
  [key: string]: (event: KeyboardEvent) => void
}

/**
 * True while a modal, popover or menu is open. reka-ui marks every such
 * surface with `data-dismissable-layer` for as long as it is mounted, and
 * dialogs additionally carry `role="dialog"` — a focus trap keeps the event
 * target inside them, but document-level listeners still see the event.
 */
export function isDialogOpen(target: HTMLElement | null): boolean {
  if (target?.closest('[role="dialog"]')) return true
  return document.querySelector("[data-dismissable-layer]") !== null
}

/**
 * Registers document-level keyboard shortcuts. Keys are lowercase single chars
 * or the special values `"escape"`, `"enter"`. Shortcuts are suppressed when
 * the event target is an editable element (input, textarea, contenteditable)
 * and while a dialog, popover or menu is open.
 */
export function useKeyboardShortcuts(map: ShortcutMap): void {
  function handler(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null
    if (target) {
      const tag = target.tagName
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return
      if (target.isContentEditable) return
    }
    if (isDialogOpen(target)) return
    const key = event.key.toLowerCase()
    const fn = map[key]
    if (!fn) return
    fn(event)
  }

  onMounted(() => document.addEventListener("keydown", handler))
  onBeforeUnmount(() => document.removeEventListener("keydown", handler))
}
