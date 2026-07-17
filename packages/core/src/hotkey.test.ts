import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { attachHotkey, parseHotkey } from "./hotkey"

// happy-dom bootstrap mirrors display-media.test.ts — attachHotkey needs a
// real `window` with addEventListener + KeyboardEvent + element targets.
let KeyboardEventCtor: typeof KeyboardEvent

beforeAll(async () => {
  const { Window } = await import("happy-dom")
  const win = new Window({ url: "https://example.test" })
  Object.assign(globalThis, {
    window: win,
    document: win.document,
    location: win.location,
    navigator: win.navigator,
    KeyboardEvent: win.KeyboardEvent,
    HTMLElement: win.HTMLElement,
  })
  KeyboardEventCtor = win.KeyboardEvent as unknown as typeof KeyboardEvent
})

afterAll(() => {
  const g = globalThis as unknown as Record<string, unknown>
  delete g.window
  delete g.document
  delete g.location
  delete g.navigator
  delete g.KeyboardEvent
  delete g.HTMLElement
})

describe("parseHotkey", () => {
  test("parses modifiers + key", () => {
    expect(parseHotkey("ctrl+shift+b")).toEqual({
      ctrl: true,
      shift: true,
      alt: false,
      meta: false,
      key: "b",
    })
  })

  test("is case- and whitespace-insensitive and accepts aliases", () => {
    expect(parseHotkey("  Control + ALT + K ")).toEqual({
      ctrl: true,
      shift: false,
      alt: true,
      meta: false,
      key: "k",
    })
    expect(parseHotkey("cmd+shift+p")).toEqual({
      ctrl: false,
      shift: true,
      alt: false,
      meta: true,
      key: "p",
    })
  })

  test("returns null for an empty / modifier-only / non-string spec", () => {
    expect(parseHotkey("")).toBeNull()
    expect(parseHotkey("   ")).toBeNull()
    expect(parseHotkey("ctrl+shift")).toBeNull()
    // @ts-expect-error — defensive against non-string input
    expect(parseHotkey(undefined)).toBeNull()
  })
})

describe("attachHotkey", () => {
  function dispatch(init: KeyboardEventInit, target?: EventTarget) {
    const ev = new KeyboardEventCtor("keydown", { bubbles: true, ...init })
    ;(target ?? window).dispatchEvent(ev)
  }

  test("fires only on a matching keydown and stops after detach", () => {
    let hits = 0
    const detach = attachHotkey("ctrl+shift+b", () => hits++)

    dispatch({ ctrlKey: true, shiftKey: true, key: "b" })
    expect(hits).toBe(1)

    // wrong modifiers / wrong key do not fire
    dispatch({ ctrlKey: true, shiftKey: false, key: "b" })
    dispatch({ ctrlKey: true, shiftKey: true, key: "x" })
    expect(hits).toBe(1)

    detach()
    dispatch({ ctrlKey: true, shiftKey: true, key: "b" })
    expect(hits).toBe(1)
  })

  test("ignores keydowns whose target is an editable element", () => {
    let hits = 0
    const detach = attachHotkey("ctrl+shift+b", () => hits++)
    const textarea = document.createElement("textarea")
    document.body.appendChild(textarea)

    dispatch({ ctrlKey: true, shiftKey: true, key: "b" }, textarea as unknown as EventTarget)
    expect(hits).toBe(0)

    detach()
    textarea.remove()
  })

  test("an invalid spec attaches nothing and returns a no-op detach", () => {
    let hits = 0
    const detach = attachHotkey("", () => hits++)
    dispatch({ key: "b" })
    expect(hits).toBe(0)
    expect(() => detach()).not.toThrow()
  })
})
