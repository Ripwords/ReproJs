import { afterEach, describe, expect, test } from "bun:test"
import { Window } from "happy-dom"
import { decodeImage, sourceHeight, sourceWidth } from "./decode-image"

type Mutable = Record<string, unknown>

function setupDom() {
  const win = new Window()
  const g = globalThis as unknown as Mutable
  g.document = win.document
  g.window = win
  return win
}

// Keep the real URL constructor intact — happy-dom's Window needs it. Only the
// object-URL helpers get stubbed, and only for the duration of a test.
const realCreateObjectURL = URL.createObjectURL
const realRevokeObjectURL = URL.revokeObjectURL
const realImage = (globalThis as unknown as Mutable).Image
const realCreateImageBitmap = (globalThis as unknown as Mutable).createImageBitmap

function stubObjectUrl(create: () => string, revoke: () => void) {
  URL.createObjectURL = create as unknown as typeof URL.createObjectURL
  URL.revokeObjectURL = revoke as unknown as typeof URL.revokeObjectURL
}

afterEach(() => {
  const g = globalThis as unknown as Mutable
  g.createImageBitmap = realCreateImageBitmap
  g.Image = realImage
  URL.createObjectURL = realCreateObjectURL
  URL.revokeObjectURL = realRevokeObjectURL
})

const PNG = new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" })

describe("decodeImage", () => {
  // The reason this module exists: host pages commonly ship
  // `img-src 'self' data:` with no `blob:`. Routing the screenshot through
  // URL.createObjectURL + <img> gets refused by CSP, fires `error` instead of
  // `load`, and used to strand the reporter on "Capturing…" forever.
  // createImageBitmap decodes the Blob directly with no resource fetch, so
  // img-src never applies.
  test("decodes via createImageBitmap without minting a blob: URL", async () => {
    setupDom()
    const g = globalThis as unknown as Mutable
    const bitmap = { width: 800, height: 600, close: () => {} }
    g.createImageBitmap = async () => bitmap

    let objectUrls = 0
    stubObjectUrl(
      () => {
        objectUrls++
        return "blob:nope"
      },
      () => {},
    )

    const out = await decodeImage(PNG)

    expect(out).toBe(bitmap as unknown as ImageBitmap)
    expect(objectUrls).toBe(0)
  })

  test("returns null instead of hanging when the image cannot be decoded", async () => {
    setupDom()
    const g = globalThis as unknown as Mutable
    g.createImageBitmap = undefined
    // Simulate the CSP refusal: assigning src fires `error`, never `load`.
    g.Image = class {
      onload: (() => void) | null = null
      listeners: Record<string, Array<() => void>> = {}
      addEventListener(type: string, cb: () => void) {
        ;(this.listeners[type] ??= []).push(cb)
      }
      set src(_v: string) {
        queueMicrotask(() => this.listeners.error?.forEach((cb) => cb()))
      }
    }

    const out = await decodeImage(PNG)

    expect(out).toBeNull()
  })

  test("falls back to an <img> when createImageBitmap is unavailable", async () => {
    setupDom()
    const g = globalThis as unknown as Mutable
    g.createImageBitmap = undefined
    let revoked = 0
    stubObjectUrl(
      () => "blob:ok",
      () => {
        revoked++
      },
    )
    const img: Mutable = {}
    g.Image = class {
      naturalWidth = 320
      naturalHeight = 240
      listeners: Record<string, Array<() => void>> = {}
      constructor() {
        Object.assign(img, this)
      }
      addEventListener(type: string, cb: () => void) {
        ;(this.listeners[type] ??= []).push(cb)
      }
      set src(_v: string) {
        queueMicrotask(() => this.listeners.load?.forEach((cb) => cb()))
      }
    }

    const out = await decodeImage(PNG)

    if (!out) throw new Error("expected decodeImage to fall back to an <img>")
    expect(sourceWidth(out)).toBe(320)
    expect(sourceHeight(out)).toBe(240)
    // The object URL must not leak once the image has loaded.
    expect(revoked).toBe(1)
  })
})

describe("sourceWidth / sourceHeight", () => {
  test("reads intrinsic dimensions from an ImageBitmap", () => {
    const bitmap = { width: 1280, height: 720 } as unknown as ImageBitmap
    expect(sourceWidth(bitmap)).toBe(1280)
    expect(sourceHeight(bitmap)).toBe(720)
  })

  test("prefers naturalWidth/naturalHeight on an HTMLImageElement", () => {
    // width/height are layout attributes and can disagree with the real
    // pixel dimensions; the annotation canvas needs the intrinsic ones.
    const img = {
      naturalWidth: 1280,
      naturalHeight: 720,
      width: 100,
      height: 50,
    } as unknown as HTMLImageElement
    expect(sourceWidth(img)).toBe(1280)
    expect(sourceHeight(img)).toBe(720)
  })
})
