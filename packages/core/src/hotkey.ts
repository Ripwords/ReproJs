// A tiny keyboard-shortcut layer for opening the widget menu. Deliberately
// fail-open: an unparseable spec attaches nothing (returns a no-op detach)
// rather than throwing, so a typo in host config can never break the page.

export interface ParsedHotkey {
  ctrl: boolean
  shift: boolean
  alt: boolean
  meta: boolean
  key: string
}

/**
 * Parse a spec like "ctrl+shift+b" into its modifier flags + the single
 * non-modifier key. Case- and whitespace-insensitive; accepts common aliases
 * (control, cmd/command/super → meta, option → alt). Returns null when the
 * spec has no non-modifier key (empty, whitespace-only, or modifiers-only) or
 * isn't a string.
 */
export function parseHotkey(spec: string): ParsedHotkey | null {
  if (typeof spec !== "string") return null
  const parts = spec
    .split("+")
    .map((p) => p.trim().toLowerCase())
    .filter((p) => p.length > 0)
  if (parts.length === 0) return null

  let ctrl = false
  let shift = false
  let alt = false
  let meta = false
  let key = ""
  for (const p of parts) {
    if (p === "ctrl" || p === "control") ctrl = true
    else if (p === "shift") shift = true
    else if (p === "alt" || p === "option") alt = true
    else if (p === "meta" || p === "cmd" || p === "command" || p === "super") meta = true
    else key = p
  }
  if (!key) return null
  return { ctrl, shift, alt, meta, key }
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== "object") return false
  const el = target as HTMLElement
  const tag = el.tagName?.toLowerCase?.()
  if (tag === "input" || tag === "textarea" || tag === "select") return true
  if (el.isContentEditable) return true
  const ce = el.getAttribute?.("contenteditable")
  return ce === "" || ce === "true"
}

/**
 * Attach a global keydown listener that invokes `onTrigger` when the parsed
 * shortcut matches. Ignores events originating from editable elements (so the
 * shortcut never hijacks typing). Returns a detach function; if the spec is
 * invalid the listener is never attached and detach is a no-op.
 */
export function attachHotkey(spec: string, onTrigger: () => void): () => void {
  const parsed = parseHotkey(spec)
  if (!parsed) return () => {}
  const handler = (event: KeyboardEvent) => {
    if (isEditableTarget(event.target)) return
    if (event.ctrlKey !== parsed.ctrl) return
    if (event.shiftKey !== parsed.shift) return
    if (event.altKey !== parsed.alt) return
    if (event.metaKey !== parsed.meta) return
    if ((event.key ?? "").toLowerCase() !== parsed.key) return
    event.preventDefault()
    onTrigger()
  }
  window.addEventListener("keydown", handler)
  return () => window.removeEventListener("keydown", handler)
}
