import { describe, expect, test, beforeAll, beforeEach, mock } from "bun:test"

beforeAll(async () => {
  const { Window } = await import("happy-dom")
  const win = new Window({ url: "http://localhost:4000" })
  Object.assign(globalThis, {
    window: win,
    document: win.document,
    location: win.location,
    navigator: win.navigator,
  })
})

type DomOptions = { filter?: (node: Node) => boolean; features?: unknown }
let lastDomOptions: DomOptions | undefined
let domToBlobCalls = 0
let displayDuringDomCapture: string | null = null

mock.module("modern-screenshot", () => ({
  domToBlob: async (_node: Node, options?: DomOptions) => {
    domToBlobCalls += 1
    lastDomOptions = options
    const host = document.getElementById("repro-host") as HTMLElement | null
    displayDuringDomCapture = host ? host.style.display : null
    return new Blob([new Uint8Array([1])], { type: "image/png" })
  },
}))

let displayMediaResult: Blob | null = null
let displayDuringDisplayMediaCapture: string | null = null
let displayMediaCalls = 0

mock.module("./display-media", () => ({
  captureViaDisplayMedia: async () => {
    displayMediaCalls += 1
    const host = document.getElementById("repro-host") as HTMLElement | null
    displayDuringDisplayMediaCapture = host ? host.style.display : null
    return displayMediaResult
  },
}))

import { capture } from "./screenshot"

beforeEach(() => {
  lastDomOptions = undefined
  domToBlobCalls = 0
  displayDuringDomCapture = null
  displayMediaCalls = 0
  displayDuringDisplayMediaCapture = null
  displayMediaResult = null
  const stale = document.getElementById("repro-host")
  if (stale) stale.remove()
})

describe("capture (DOM path)", () => {
  test("returns a PNG blob on success", async () => {
    const blob = await capture({ method: "dom" })
    expect(blob).toBeInstanceOf(Blob)
    expect(blob?.type).toBe("image/png")
    expect(domToBlobCalls).toBe(1)
  })

  test("does not hide the widget host while the DOM capture is in flight", async () => {
    const host = document.createElement("div")
    host.id = "repro-host"
    host.style.display = "block"
    document.body.appendChild(host)
    await capture({ method: "dom" })
    // DOM capture can stall on resource inlining; the launcher must stay
    // visible the whole time. Exclusion is done via the filter callback.
    expect(displayDuringDomCapture).toBe("block")
    expect(host.style.display).toBe("block")
    host.remove()
  })

  test("filter excludes the widget host", async () => {
    const host = document.createElement("div")
    host.id = "repro-host"
    document.body.appendChild(host)
    const unrelated = document.createElement("div")
    unrelated.id = "page-content"
    document.body.appendChild(unrelated)

    await capture({ method: "dom" })

    expect(typeof lastDomOptions?.filter).toBe("function")
    expect(lastDomOptions?.filter?.(host)).toBe(false)
    expect(lastDomOptions?.filter?.(unrelated)).toBe(true)

    host.remove()
    unrelated.remove()
  })

  test("offsets the clone by the page's scroll position", async () => {
    // modern-screenshot draws the clone from the document's top-left unless
    // restoreScrollPosition is on — the only feature it leaves off by default.
    // Without it a scrolled reporter always gets the first screenful.
    await capture({ method: "dom" })
    expect(lastDomOptions?.features).toEqual({ restoreScrollPosition: true })
  })

  test("filter excludes <nextjs-portal> by default", async () => {
    const portal = document.createElement("nextjs-portal")
    document.body.appendChild(portal)
    await capture({ method: "dom" })
    expect(lastDomOptions?.filter?.(portal)).toBe(false)
    portal.remove()
  })

  test("filter excludes user-provided selectors", async () => {
    const intercom = document.createElement("div")
    intercom.className = "intercom-launcher"
    document.body.appendChild(intercom)
    const keep = document.createElement("div")
    keep.className = "intercom-fake"
    document.body.appendChild(keep)

    await capture({ method: "dom", excludeSelectors: [".intercom-launcher"] })

    expect(lastDomOptions?.filter?.(intercom)).toBe(false)
    expect(lastDomOptions?.filter?.(keep)).toBe(true)

    intercom.remove()
    keep.remove()
  })
})

describe("capture (orchestration)", () => {
  test("auto: tries display-media first, returns its blob when it succeeds", async () => {
    const winning = new Blob([new Uint8Array([2])], { type: "image/png" })
    displayMediaResult = winning
    const blob = await capture({ method: "auto" })
    expect(blob).toBe(winning)
    expect(displayMediaCalls).toBe(1)
    expect(domToBlobCalls).toBe(0)
  })

  test("auto: returns null when display-media returns null (no DOM fallback)", async () => {
    // The DOM fallback used to run here, but it can stall indefinitely on
    // heavy pages and strands users on the "Capturing…" overlay. A null
    // result lets the wizard advance to the description step without a
    // screenshot.
    displayMediaResult = null
    const blob = await capture({ method: "auto" })
    expect(blob).toBeNull()
    expect(displayMediaCalls).toBe(1)
    expect(domToBlobCalls).toBe(0)
  })

  test("auto is the default method", async () => {
    displayMediaResult = new Blob([new Uint8Array([3])], { type: "image/png" })
    await capture()
    expect(displayMediaCalls).toBe(1)
  })

  test("dom: skips display-media entirely", async () => {
    displayMediaResult = new Blob([new Uint8Array([4])], { type: "image/png" })
    await capture({ method: "dom" })
    expect(displayMediaCalls).toBe(0)
    expect(domToBlobCalls).toBe(1)
  })

  test("display-media: never falls back to DOM, returns null on failure", async () => {
    displayMediaResult = null
    const blob = await capture({ method: "display-media" })
    expect(blob).toBeNull()
    expect(displayMediaCalls).toBe(1)
    expect(domToBlobCalls).toBe(0)
  })

  test("hides the widget host during the display-media await", async () => {
    const host = document.createElement("div")
    host.id = "repro-host"
    host.style.display = "block"
    document.body.appendChild(host)

    displayMediaResult = new Blob([new Uint8Array([5])], { type: "image/png" })
    await capture({ method: "auto" })

    // The display-media path captures real screen pixels; the widget would
    // otherwise appear in the frame. Hide is bounded by the user clicking
    // the browser-native "Share" prompt, so it can't strand the launcher.
    expect(displayDuringDisplayMediaCapture).toBe("none")
    // And it's restored after the capture resolves.
    expect(host.style.display).toBe("block")

    host.remove()
  })
})
