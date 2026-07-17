// packages/ui/src/capture-flow.test.ts
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test"
import { h, render } from "preact"
import { reset } from "./annotation/store"
import { CaptureFlow } from "./capture-flow"

// Mirrors wizard/step-annotate.test.ts's environment: CaptureFlow's annotate
// stage mounts the real <StepAnnotate>/<Canvas>, which needs a working
// HTMLCanvasElement.getContext("2d"), ResizeObserver, and requestAnimationFrame
// — none of which happy-dom implements out of the box.
//
// Unlike step-annotate.test.ts (which patches these globals and never
// restores them), this file snapshots every touched key and restores it in
// afterAll. bun:test runs all files in one process with a shared globalThis,
// and this file's leaked `Image`/`HTMLCanvasElement` (bound to *this* file's
// happy-dom Window) previously broke gallery/thumbnail.test.ts, which runs
// later alphabetically ("capture-flow.test.ts" < "gallery/thumbnail.test.ts")
// and needs the real, unpatched fallback path to fail fast on bad image
// bytes. Left patched, its `new Image()` was silently wired to a torn-down
// window and stalled until decode-image.ts's 10s internal timeout, well past
// bun's 5s per-test default.
const ORIGINAL_GLOBALS: Record<string, unknown> = {}
const PATCHED_KEYS = [
  "window",
  "document",
  "HTMLCanvasElement",
  "HTMLImageElement",
  "Image",
  "KeyboardEvent",
  "Event",
  "navigator",
  "ResizeObserver",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "createImageBitmap",
] as const

beforeAll(async () => {
  const { Window } = await import("happy-dom")
  const { createCanvas } = await import("@napi-rs/canvas")

  for (const key of PATCHED_KEYS) {
    ORIGINAL_GLOBALS[key] = (globalThis as unknown as Record<string, unknown>)[key]
  }

  const win = new Window()

  ;(win.HTMLCanvasElement.prototype as unknown as Record<string, unknown>).getContext = function (
    this: { width: number; height: number },
    type: string,
  ) {
    const c = createCanvas(this.width || 1, this.height || 1)
    return c.getContext(type as "2d")
  }

  Object.assign(globalThis, {
    window: win,
    document: win.document,
    HTMLCanvasElement: win.HTMLCanvasElement,
    HTMLImageElement: win.HTMLImageElement,
    Image: win.Image,
    KeyboardEvent: win.KeyboardEvent,
    Event: win.Event,
    navigator: win.navigator,
    ResizeObserver: class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
    requestAnimationFrame: (cb: FrameRequestCallback) => {
      setTimeout(() => cb(performance.now()), 0)
      return 0
    },
    cancelAnimationFrame: () => {},
    // decodeImage's primary path. Unlike decode-image.test.ts's own stub
    // (a bare {width,height} object), the value here also gets drawn —
    // both by the annotation Canvas (bg) and by BlobImage (outcome
    // preview) — through the real @napi-rs/canvas 2D context patched
    // above, which requires an actual canvas-shaped image, not a plain
    // object. A real (blank) napi-rs canvas satisfies both call sites.
    createImageBitmap: async () => {
      const bitmap = createCanvas(400, 300)
      const ctx = bitmap.getContext("2d")
      ctx.fillStyle = "#ffffff"
      ctx.fillRect(0, 0, 400, 300)
      return Object.assign(bitmap, { close: () => {} })
    },
  })
})

afterAll(() => {
  for (const key of PATCHED_KEYS) {
    const value = ORIGINAL_GLOBALS[key]
    if (value === undefined) delete (globalThis as unknown as Record<string, unknown>)[key]
    else (globalThis as unknown as Record<string, unknown>)[key] = value
  }
})

beforeEach(() => {
  reset()
  document.body.innerHTML = ""
})

// Walk helpers at module scope (avoids lint consistent-function-scoping error)
function walkAllByClass(node: Element, cls: string): Element[] {
  const out: Element[] = []
  const classes = node.className?.split?.(" ") ?? []
  if (classes.includes(cls)) out.push(node)
  for (let i = 0; i < node.childNodes.length; i++) {
    const child = node.childNodes[i]
    if (child && (child as Element).tagName) out.push(...walkAllByClass(child as Element, cls))
  }
  return out
}

async function waitFor(predicate: () => boolean, timeoutMs = 500): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) return // let the caller's own `expect` fail with a clear diff
    await new Promise((r) => setTimeout(r, 5))
  }
}

function mountHost(): HTMLElement {
  const host = document.createElement("div") as unknown as HTMLElement
  Object.defineProperty(host, "clientWidth", { value: 800, configurable: true })
  Object.defineProperty(host, "clientHeight", { value: 600, configurable: true })
  document.body.appendChild(host)
  return host
}

// A minimal PNG-typed Blob — decodeImage never actually decodes real bytes
// here since createImageBitmap is stubbed above (same approach as
// decode-image.test.ts's PNG fixture).
function makePngBlob(): Blob {
  return new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], { type: "image/png" })
}

describe("CaptureFlow", () => {
  test("a null capture (denied dialog) discards silently without reaching annotate", async () => {
    const host = mountHost()
    let doneOutcome: unknown = null

    render(
      h(CaptureFlow, {
        onCapture: async () => null,
        onDone: (outcome) => {
          doneOutcome = outcome
        },
      }),
      host,
    )

    await waitFor(() => doneOutcome !== null)

    expect(doneOutcome).toEqual({ action: "discarded" })
    expect(walkAllByClass(host, "ft-wizard-annotate").length).toBe(0)

    render(null, host)
    await new Promise((r) => setTimeout(r, 0))
  })

  test("a real capture reaches the annotate stage", async () => {
    const host = mountHost()
    let doneOutcome: unknown = null

    render(
      h(CaptureFlow, {
        onCapture: async () => makePngBlob(),
        onDone: (outcome) => {
          doneOutcome = outcome
        },
      }),
      host,
    )

    await waitFor(() => walkAllByClass(host, "ft-wizard-annotate").length > 0)

    expect(walkAllByClass(host, "ft-wizard-annotate").length).toBe(1)
    expect(doneOutcome).toBeNull() // onDone must not fire just from reaching annotate

    render(null, host)
    await new Promise((r) => setTimeout(r, 0))
  })

  test("Skip from annotate lands on the outcome bar with the raw capture, and Save reports it once", async () => {
    const host = mountHost()
    let doneOutcome: unknown = null

    render(
      h(CaptureFlow, {
        onCapture: async () => makePngBlob(),
        onDone: (outcome) => {
          doneOutcome = outcome
        },
      }),
      host,
    )

    await waitFor(() => walkAllByClass(host, "ft-wizard-annotate").length > 0)

    const buttons = walkAllByClass(host, "ft-btn-secondary") as unknown as HTMLElement[]
    const skipBtn = buttons.find((b) => b.textContent?.includes("Skip"))
    expect(skipBtn).toBeTruthy()
    skipBtn?.click()

    await waitFor(() => walkAllByClass(host, "ft-outcome-bar").length > 0)
    expect(walkAllByClass(host, "ft-outcome-bar").length).toBe(1)

    // The outcome preview is a <canvas> (BlobImage) whose own decode effect
    // is a *passive* effect — deferred past the render pass that just made
    // "ft-outcome-bar" appear. Wait for it to actually settle (its width
    // flips from the HTML canvas default of 300 to our stub bitmap's 400)
    // before this test ends and its file's afterAll restores the globals
    // (Image, createImageBitmap) that a still-pending decode would need.
    await waitFor(() => {
      const canvases = walkAllByClass(host, "ft-outcome-preview") as unknown as HTMLCanvasElement[]
      return canvases[0]?.width === 400
    })

    const saveBtn = (walkAllByClass(host, "ft-btn-secondary") as unknown as HTMLElement[]).find(
      (b) => b.textContent?.includes("Save to gallery"),
    )
    expect(saveBtn).toBeTruthy()
    saveBtn?.click()

    expect(doneOutcome).toMatchObject({ action: "saved" })
    const item = (doneOutcome as { item: { kind: string; mime: string } }).item
    expect(item.kind).toBe("image")
    expect(item.mime).toBe("image/png")

    render(null, host)
    await new Promise((r) => setTimeout(r, 0))
  })
})
