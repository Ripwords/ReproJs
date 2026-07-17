/** @jsxImportSource preact */
import { afterEach, describe, expect, test } from "bun:test"
import { Window } from "happy-dom"
import { close, mount, open, openMenu, unmount, type MountOptions } from "./mount"
import { createShadowHost } from "./shadow"

const realDocument = globalThis.document
const realWindow = globalThis.window

function setupDom() {
  const win = new Window({ url: "https://example.test" })
  // @ts-expect-error happy-dom globals
  globalThis.document = win.document
  // @ts-expect-error
  globalThis.window = win
  // @ts-expect-error
  globalThis.HTMLElement = win.HTMLElement
  // @ts-expect-error
  globalThis.Event = win.Event
  // @ts-expect-error
  globalThis.KeyboardEvent = win.KeyboardEvent
  return win
}

afterEach(() => {
  unmount()
  // @ts-expect-error
  globalThis.document = realDocument
  // @ts-expect-error
  globalThis.window = realWindow
})

// Flush pending microtasks + preact post-commit effects (openGallery resolves,
// mode transitions commit). Same setTimeout flush the other UI tests use.
function flush(ms = 50): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function makeOpts(overrides: Partial<MountOptions> = {}): MountOptions {
  return {
    config: { position: "bottom-right", launcher: true },
    capture: async () => null,
    startRecording: async () => null,
    onSubmit: async () => ({ ok: true }),
    ...overrides,
  }
}

describe("mount mode machine", () => {
  test("openMenu() renders the three primary launcher options", async () => {
    setupDom()
    mount(makeOpts())
    const root = createShadowHost()
    openMenu()
    await flush()
    expect(root.textContent).toContain("Capture")
    expect(root.textContent).toContain("Record screen")
    expect(root.textContent).toContain("Report bug")
  })

  test("open() renders the report wizard directly (back-compat)", async () => {
    setupDom()
    mount(makeOpts())
    const root = createShadowHost()
    open()
    await flush()
    // WizardHeader title from Reporter — proves we're in the report wizard,
    // not the launcher menu.
    expect(root.textContent).toContain("Report a bug")
    expect(root.textContent).not.toContain("Record screen")
  })

  test("close() returns to closed and fires onClose exactly once", async () => {
    let closes = 0
    let opens = 0
    setupDom()
    mount(makeOpts({ onOpen: () => opens++, onClose: () => closes++ }))
    const root = createShadowHost()

    open()
    await flush()
    expect(opens).toBe(1)
    expect(closes).toBe(0)

    close()
    await flush()
    expect(closes).toBe(1)
    expect(root.textContent).not.toContain("Report a bug")
  })
})
