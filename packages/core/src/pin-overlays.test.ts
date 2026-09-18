import { beforeAll, describe, expect, test } from "bun:test"
import { createOverlayPinner } from "./pin-overlays"

// Runs the real modern-screenshot cloner (domToForeignObjectSvg stops before
// rasterising, which happy-dom can't do). happy-dom has no layout, so scroll
// offsets and on-screen rects are stubbed on the source elements.

type ModernScreenshot = typeof import("modern-screenshot")
let ms: ModernScreenshot

beforeAll(async () => {
  const { Window } = await import("happy-dom")
  const win = new Window({ url: "http://localhost:4000", width: 800, height: 600 })
  Object.assign(globalThis, {
    window: win,
    document: win.document,
    location: win.location,
    navigator: win.navigator,
  })
  ms = await import("modern-screenshot")
})

function stubScroll(el: Element, top: number) {
  Object.defineProperty(el, "scrollTop", { configurable: true, get: () => top })
}

function stubRect(el: Element, x: number, y: number, width: number, height: number) {
  const rect = { x, y, left: x, top: y, width, height, right: x + width, bottom: y + height }
  Object.defineProperty(el, "getBoundingClientRect", {
    configurable: true,
    value: () => ({ ...rect, toJSON: () => rect }),
  })
}

async function cloneWithPinner(): Promise<HTMLElement> {
  const root = document.documentElement
  const pinner = createOverlayPinner(root, () => true)
  const svg = await ms.domToForeignObjectSvg(root, {
    font: false,
    // The scroll-offset transforms need DOMMatrix, which happy-dom lacks. The
    // pinner doesn't read them: it resets transforms on what it pins.
    features: { restoreScrollPosition: false },
    filter: pinner.filter,
    onCloneEachNode: pinner.onCloneEachNode,
    onCloneNode: pinner.onCloneNode,
  })
  const cloned = svg.querySelector("foreignObject > html")
  if (!cloned) throw new Error("no cloned <html> in the foreignObject")
  return cloned as HTMLElement
}

function pinnedCopies(cloned: HTMLElement, id: string): HTMLElement[] {
  return [...cloned.children].filter((el): el is HTMLElement => el.id === id)
}

describe("createOverlayPinner", () => {
  test("pins a fixed element under a scrolled page to where it is on screen", async () => {
    document.body.innerHTML = `
      <nav id="side" style="position:fixed;top:0;left:0;width:180px;height:600px">menu</nav>
      <main style="height:5000px">content</main>`
    stubScroll(document.documentElement, 3000)
    stubRect(document.getElementById("side")!, 0, 0, 180, 600)

    const cloned = await cloneWithPinner()

    const [side] = pinnedCopies(cloned, "side")
    expect(side).toBeDefined()
    expect(side!.style.position).toBe("absolute")
    expect(side!.style.top).toBe("0px")
    expect(side!.style.left).toBe("0px")
    expect(side!.style.width).toBe("180px")
    expect(side!.style.height).toBe("600px")
    // Moved, not copied: a fixed element holds no space in the flow.
    expect(cloned.querySelector("body #side")).toBeNull()
  })

  test("pins a stuck sticky element and keeps an invisible stand-in in its slot", async () => {
    document.body.innerHTML = `
      <header id="hdr" style="position:sticky;top:0;height:60px">title</header>
      <main style="height:5000px">content</main>`
    stubScroll(document.documentElement, 3000)
    stubRect(document.getElementById("hdr")!, 0, 0, 800, 60)

    const cloned = await cloneWithPinner()

    const [hdr] = pinnedCopies(cloned, "hdr")
    expect(hdr).toBeDefined()
    expect(hdr!.style.position).toBe("absolute")
    expect(hdr!.style.top).toBe("0px")
    expect(hdr!.textContent).toBe("title")
    const standIn = cloned.querySelector("body #hdr") as HTMLElement | null
    expect(standIn?.style.opacity).toBe("0")
  })

  test("leaves fixed and sticky elements alone when nothing above them is scrolled", async () => {
    document.body.innerHTML = `
      <nav id="side" style="position:fixed;top:0;left:0;width:180px;height:600px">menu</nav>
      <header id="hdr" style="position:sticky;top:0;height:60px">title</header>`
    stubScroll(document.documentElement, 0)

    const cloned = await cloneWithPinner()

    expect(pinnedCopies(cloned, "side")).toHaveLength(0)
    expect(pinnedCopies(cloned, "hdr")).toHaveLength(0)
    expect(cloned.querySelector("body #side")).not.toBeNull()
  })
})
