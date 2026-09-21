/** @jsxImportSource preact */
import { afterEach, describe, expect, test } from "bun:test"
import { IDBFactory } from "fake-indexeddb"
import { Window } from "happy-dom"
import { openGallery, type GalleryItem } from "./gallery/store"
import {
  close,
  mount,
  open,
  openMenu,
  openRecord,
  unmount,
  type MountOptions,
  type RecordingResultLike,
  type RecordingSessionLike,
} from "./mount"
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

  test("openMenu() while recording is a no-op — mode stays, busy toast shown", async () => {
    setupDom()
    const root = createShadowHost()
    const fakeSession: RecordingSessionLike = {
      stop: () => {},
      cancel: () => {},
      snapshot: () => null,
    }
    mount(makeOpts({ startRecording: async () => fakeSession }))

    openRecord()
    await flush()
    expect(root.textContent).toContain("Stop") // record control bar is up

    openMenu()
    await flush()
    // Still recording — the menu did NOT replace the record UI.
    expect(root.textContent).toContain("Stop")
    expect(root.textContent).not.toContain("Record screen") // menu item absent
    expect(root.textContent).toContain("Recording in progress")
  })

  test("openRecord() while already recording does not start a second session", async () => {
    setupDom()
    createShadowHost()
    let startCalls = 0
    const fakeSession: RecordingSessionLike = {
      stop: () => {},
      cancel: () => {},
      snapshot: () => null,
    }
    mount(
      makeOpts({
        startRecording: async () => {
          startCalls++
          return fakeSession
        },
      }),
    )

    openRecord()
    await flush()
    expect(startCalls).toBe(1)

    openRecord()
    await flush()
    // Blocked by the recording-active guard — startRecording not invoked again.
    expect(startCalls).toBe(1)
  })

  test("unmount() while recording cancels the session and detaches the pagehide listener", async () => {
    const win = setupDom()
    const root = createShadowHost()

    let cancelCalls = 0
    const fakeSession: RecordingSessionLike = {
      stop: () => {},
      cancel: () => {
        cancelCalls++
      },
      snapshot: () => null,
    }

    // Snapshot/restore addEventListener + removeEventListener on the fresh
    // happy-dom window so we can track "pagehide" listener count without
    // touching global hygiene for other listener types.
    const realAdd = win.addEventListener.bind(win)
    const realRemove = win.removeEventListener.bind(win)
    let pagehideListenerCount = 0
    // @ts-expect-error patching happy-dom window for the spy
    win.addEventListener = (type: string, ...rest: unknown[]) => {
      if (type === "pagehide") pagehideListenerCount++
      // @ts-expect-error forwarding to happy-dom's real implementation
      return realAdd(type, ...rest)
    }
    // @ts-expect-error patching happy-dom window for the spy
    win.removeEventListener = (type: string, ...rest: unknown[]) => {
      if (type === "pagehide") pagehideListenerCount--
      // @ts-expect-error forwarding to happy-dom's real implementation
      return realRemove(type, ...rest)
    }

    mount(
      makeOpts({
        startRecording: async () => fakeSession,
      }),
    )

    openRecord()
    await flush()
    expect(root.textContent).toContain("Stop")
    expect(pagehideListenerCount).toBe(1)

    unmount()
    await flush()

    expect(cancelCalls).toBe(1)
    expect(pagehideListenerCount).toBe(0)
  })
})

// Walk the tree rather than querySelector/querySelectorAll, which throw in
// this happy-dom + bun setup (see menu.test.ts's walkAllByTag and
// step-review.test.ts's walkForClass, which sidestep the same bug). It is
// bun-version sensitive: the selector path happens to work on 1.4.x and
// throws "undefined is not a constructor" on CI's 1.3.x.
function walkAll(node: ParentNode, match: (el: Element) => boolean): Element[] {
  const out: Element[] = []
  if ((node as Element).tagName && match(node as Element)) out.push(node as Element)
  for (let i = 0; i < node.childNodes.length; i++) {
    const child = node.childNodes[i]
    if (child && (child as Element).tagName) out.push(...walkAll(child as Element, match))
  }
  return out
}

function walkAllByClass(root: ParentNode, cls: string): Element[] {
  return walkAll(root, (el) => (el.className?.split?.(" ") ?? []).includes(cls))
}

function clickByText(root: ParentNode, text: string) {
  const buttons = walkAll(root, (el) => el.tagName?.toLowerCase() === "button")
  const btn = buttons.find((b) => b.textContent?.trim() === text)
  if (!btn) {
    throw new Error(`No button "${text}" — saw: ${buttons.map((b) => b.textContent).join(" | ")}`)
  }
  ;(btn as unknown as HTMLElement).click()
}

function installIdb(): IDBFactory {
  const idb = new IDBFactory()
  // @ts-expect-error installing a test IndexedDB on the happy-dom global
  globalThis.indexedDB = idb
  return idb
}

// openGallery() is typed nullable (it returns null when IndexedDB is missing);
// here we just installed a factory, so a null means the test setup is broken
// and should say so rather than fail later on an unrelated assertion.
async function listGallery(idb: IDBFactory): Promise<GalleryItem[]> {
  const store = await openGallery({ indexedDB: idb })
  if (!store) throw new Error("openGallery returned null despite an installed IDBFactory")
  return await store.list()
}

// The gallery is an opt-in archive, not a log of everything the widget ever
// produced. These drive a recording to its outcome bar (no canvas needed —
// makeThumbnail short-circuits for video) and check what reaches the store.
describe("gallery persistence is opt-in", () => {
  async function driveRecordingToOutcome(win: Window, root: ShadowRoot) {
    let end: ((r: RecordingResultLike | null, reason: "stopped") => void) | null = null
    const session: RecordingSessionLike = {
      stop: () =>
        end?.(
          { blob: new Blob(["v"], { type: "video/webm" }), mime: "video/webm", durationMs: 4000 },
          "stopped",
        ),
      cancel: () => {},
      snapshot: () => null,
    }
    mount(
      makeOpts({
        startRecording: async (cb) => {
          end = cb.onEnd as typeof end
          return session
        },
      }),
    )
    openRecord()
    await flush()
    session.stop()
    await flush()
    // Trim screen -> outcome bar.
    clickByText(root, "Confirm")
    await flush()
  }

  test('"Report bug with this" attaches the clip without writing it to the gallery', async () => {
    const win = setupDom()
    const idb = installIdb()
    const root = createShadowHost()

    await driveRecordingToOutcome(win, root)
    clickByText(root, "Report bug with this")
    await flush()

    // We're in the wizard with the clip on offer as a chip...
    expect(root.textContent).toContain("Report a bug")
    expect(walkAllByClass(root, "ft-media-item").length).toBe(1)
    // ...and the archive is untouched.
    expect(await listGallery(idb)).toEqual([])
  })

  test('"Save to gallery" is what actually writes to the store', async () => {
    const win = setupDom()
    const idb = installIdb()
    const root = createShadowHost()

    await driveRecordingToOutcome(win, root)
    clickByText(root, "Save to gallery")
    await flush()

    const saved = await listGallery(idb)
    expect(saved).toHaveLength(1)
    expect(saved[0]?.kind).toBe("video")
  })
})
