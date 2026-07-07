export type Action =
  | "tool.arrow"
  | "tool.rect"
  | "tool.pen"
  | "tool.highlight"
  | "tool.text"
  | "undo"
  | "redo"
  | "clear"
  | "cancel.draft"
  | "resetView"

export const DEFAULT_SHORTCUTS: Record<string, Action> = {
  a: "tool.arrow",
  r: "tool.rect",
  p: "tool.pen",
  h: "tool.highlight",
  t: "tool.text",
  "mod+z": "undo",
  "mod+shift+z": "redo",
  "mod+y": "redo",
  backspace: "clear",
  delete: "clear",
  escape: "cancel.draft",
  "mod+0": "resetView",
}

function serializeEvent(e: KeyboardEvent): string {
  const parts: string[] = []
  if (e.metaKey || e.ctrlKey) parts.push("mod")
  if (e.shiftKey) parts.push("shift")
  if (e.altKey) parts.push("alt")
  parts.push(e.key.toLowerCase())
  return parts.join("+")
}

function isInputElement(node: unknown): boolean {
  if (!node || typeof node !== "object") return false
  const el = node as HTMLElement
  const tag = el.tagName
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true
  if (el.isContentEditable) return true
  return false
}

function isInsideInput(e: KeyboardEvent, root?: DocumentOrShadowRoot): boolean {
  // Check composedPath() so we detect input elements nested inside an *open*
  // Shadow DOM — without it, e.target retargets to the shadow host on window
  // listeners and every letter pressed inside the wizard's <textarea> would
  // trigger a tool shortcut like H or T. Fall back to e.target if the
  // composed path is empty (e.g. synthetic test events).
  const path = typeof e.composedPath === "function" ? e.composedPath() : []
  for (const node of path) {
    if (isInputElement(node)) return true
  }
  if (isInputElement(e.target)) return true
  // A *closed* ShadowRoot (mode: "closed") truncates composedPath() at the
  // host and retargets e.target to the host, so neither reveals the focused
  // element inside the tree. The widget owns the ShadowRoot reference, so pass
  // it here and consult its activeElement — that's the only view into a closed
  // tree from a window listener.
  if (root && isInputElement(root.activeElement)) return true
  return false
}

export function matchShortcut(
  e: KeyboardEvent,
  map: Record<string, Action>,
  root?: DocumentOrShadowRoot,
): Action | null {
  if (isInsideInput(e, root)) return null
  const serialized = serializeEvent(e)
  return map[serialized] ?? null
}

export function registerShortcuts(
  target: EventTarget,
  map: Record<string, Action>,
  dispatch: (action: Action, e: KeyboardEvent) => void,
  root?: DocumentOrShadowRoot,
): () => void {
  const handler = (raw: Event) => {
    const e = raw as KeyboardEvent
    const action = matchShortcut(e, map, root)
    if (action) {
      e.preventDefault()
      dispatch(action, e)
    }
  }
  target.addEventListener("keydown", handler)
  return () => target.removeEventListener("keydown", handler)
}
