import { beforeAll, describe, expect, test } from "bun:test"
import { DEFAULT_SHORTCUTS, matchShortcut, type Action } from "./shortcuts"

beforeAll(async () => {
  const { Window } = await import("happy-dom")
  const win = new Window()
  Object.assign(globalThis, {
    window: win,
    document: win.document,
    KeyboardEvent: win.KeyboardEvent,
  })
})

function ev(key: string, opts: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return new KeyboardEvent("keydown", { key, ...opts })
}

describe("matchShortcut", () => {
  test("matches a plain letter key", () => {
    expect(matchShortcut(ev("a"), DEFAULT_SHORTCUTS)).toBe<Action>("tool.arrow")
    expect(matchShortcut(ev("r"), DEFAULT_SHORTCUTS)).toBe<Action>("tool.rect")
    expect(matchShortcut(ev("t"), DEFAULT_SHORTCUTS)).toBe<Action>("tool.text")
  })

  test("matches mod+z (metaKey on mac, ctrlKey elsewhere)", () => {
    expect(matchShortcut(ev("z", { metaKey: true }), DEFAULT_SHORTCUTS)).toBe<Action>("undo")
    expect(matchShortcut(ev("z", { ctrlKey: true }), DEFAULT_SHORTCUTS)).toBe<Action>("undo")
  })

  test("matches mod+shift+z as redo", () => {
    expect(
      matchShortcut(ev("z", { metaKey: true, shiftKey: true }), DEFAULT_SHORTCUTS),
    ).toBe<Action>("redo")
  })

  test("ignores shortcuts inside text input", () => {
    const target = document.createElement("textarea")
    const e = new KeyboardEvent("keydown", { key: "a" })
    Object.defineProperty(e, "target", { value: target })
    expect(matchShortcut(e, DEFAULT_SHORTCUTS)).toBeNull()
  })

  test("ignores shortcuts when a closed-shadow input is focused", () => {
    // A closed ShadowRoot hides internal nodes from a window listener:
    // composedPath() is truncated at the host and e.target retargets to the
    // host, so neither reveals the focused <textarea>. The widget passes its
    // ShadowRoot so the guard can consult root.activeElement instead.
    const textarea = document.createElement("textarea")
    const host = document.createElement("div")
    const root = { activeElement: textarea } as unknown as DocumentOrShadowRoot
    const e = new KeyboardEvent("keydown", { key: "h" })
    Object.defineProperty(e, "target", { value: host })
    Object.defineProperty(e, "composedPath", { value: () => [host] })

    // Without the root, the bug reproduces: the shortcut leaks through.
    expect(matchShortcut(e, DEFAULT_SHORTCUTS)).toBe<Action>("tool.highlight")
    // With the root, the guard sees the focused textarea and suppresses it.
    expect(matchShortcut(e, DEFAULT_SHORTCUTS, root)).toBeNull()
  })

  test("returns null when no shortcut matches", () => {
    expect(matchShortcut(ev("q"), DEFAULT_SHORTCUTS)).toBeNull()
  })
})
