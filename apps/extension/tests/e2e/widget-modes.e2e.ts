import { chromium, expect, test } from "@playwright/test"
import type { Page, BrowserContext, CDPSession } from "@playwright/test"
import { createServer } from "node:http"
import { readFileSync, mkdtempSync } from "node:fs"
import { dirname, resolve as resolvePath } from "node:path"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const EXT_PATH = resolvePath(__dirname, "../../dist-e2e")
const FIXTURE = readFileSync(resolvePath(__dirname, "fixtures/test-site.html"), "utf8")

// ---------------------------------------------------------------------------
// The widget mounts inside a ShadowRoot with mode: "closed" (packages/ui/src
// /shadow.ts), so Playwright's own locator engine cannot see or interact
// with anything past #repro-host — confirmed empirically before writing this
// spec: page.getByRole(), page.locator(".ft-launcher"), and
// locator.ariaSnapshot() all fail to find widget-internal elements, even
// though host.shadowRoot === null proves the closure is real (existing
// inject.e2e.ts only ever asserts on #repro-host for exactly this reason).
//
// Chrome DevTools Protocol, however, operates at the render-engine level
// (it's what powers DevTools' own Elements panel showing closed shadow
// content) and is unaffected by the JS-facing `shadowRoot` restriction.
// `DOM.getFlattenedDocument({ pierce: true })` returns every node including
// closed-shadow descendants, and `DOM.getBoxModel` gives real viewport
// coordinates for them. Combining that with `page.mouse.click(x, y)` — a
// genuinely trusted mouse event dispatched at real screen coordinates,
// required for getDisplayMedia's user-activation gate — lets this spec
// drive the actual widget UI and assert on real structure/text instead of
// falling back to screenshot diffing. Every locator below is a CDP node
// query, not a Playwright locator.
// ---------------------------------------------------------------------------

interface CdpNode {
  nodeId: number
  parentId?: number
  backendNodeId: number
  nodeType: number
  nodeName: string
  localName?: string
  nodeValue: string
  attributes?: string[]
}

function attrOf(node: CdpNode, name: string): string | undefined {
  const a = node.attributes
  if (!a) return undefined
  const i = a.indexOf(name)
  return i >= 0 && i % 2 === 0 ? a[i + 1] : undefined
}

function hasClass(node: CdpNode, cls: string): boolean {
  const c = attrOf(node, "class")
  return Boolean(c && c.split(/\s+/).includes(cls))
}

/** Concatenate the text of every #text descendant of `root` in document
 * order, walking the flat node list via parentId (DOM.getFlattenedDocument
 * doesn't nest `children` the way DOM.getDocument does). Recursive
 * (pre-order) rather than an explicit LIFO stack — a stack that pushes all
 * children then pops visits them in reverse, scrambling sibling order. */
function textOf(nodes: CdpNode[], root: CdpNode): string {
  const byParent = new Map<number, CdpNode[]>()
  for (const n of nodes) {
    if (n.parentId == null) continue
    const list = byParent.get(n.parentId) ?? []
    list.push(n)
    byParent.set(n.parentId, list)
  }
  function walk(node: CdpNode): string {
    if (node.nodeType === 3) return node.nodeValue
    const kids = byParent.get(node.nodeId) ?? []
    return kids.map(walk).join("")
  }
  return walk(root)
}

async function flat(cdp: CDPSession): Promise<CdpNode[]> {
  const doc = await cdp.send("DOM.getFlattenedDocument", { depth: -1, pierce: true })
  return doc.nodes as CdpNode[]
}

async function centerOf(cdp: CDPSession, node: CdpNode): Promise<{ x: number; y: number }> {
  const box = await cdp.send("DOM.getBoxModel", { nodeId: node.nodeId })
  const [x1, y1, x2, y2, x3, y3, x4, y4] = box.model.content
  return { x: (x1 + x2 + x3 + x4) / 4, y: (y1 + y2 + y3 + y4) / 4 }
}

async function click(cdp: CDPSession, page: Page, node: CdpNode): Promise<void> {
  const { x, y } = await centerOf(cdp, node)
  await page.mouse.click(x, y)
}

/** Poll `DOM.getFlattenedDocument` until `predicate` finds a node, or throw
 * after `timeoutMs`. Standing in for Playwright's own auto-waiting locators,
 * which don't work here (see header comment). */
async function waitForNode(
  cdp: CDPSession,
  predicate: (n: CdpNode, all: CdpNode[]) => boolean,
  opts: { timeoutMs?: number; label?: string } = {},
): Promise<CdpNode> {
  const timeoutMs = opts.timeoutMs ?? 10_000
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const nodes = await flat(cdp)
    const found = nodes.find((n) => predicate(n, nodes))
    if (found) return found
    if (Date.now() > deadline) {
      throw new Error(
        `waitForNode timed out after ${timeoutMs}ms${opts.label ? `: ${opts.label}` : ""}`,
      )
    }
    await new Promise((r) => setTimeout(r, 200))
  }
}

async function setupExtensionContext(testOrigin: string): Promise<{
  context: BrowserContext
  page: Page
  cdp: CDPSession
}> {
  const userDataDir = mkdtempSync(resolvePath(tmpdir(), "repro-ext-widget-modes-"))
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${EXT_PATH}`,
      `--load-extension=${EXT_PATH}`,
      "--no-sandbox",
      // Auto-accept the getDisplayMedia() screen-picker with "Entire screen"
      // and auto-accept any getUserMedia() prompt, so screen recording runs
      // headlessly without a human clicking a native OS dialog. NOTE: on
      // macOS this only bypasses Chrome's *in-app* picker UI — the OS-level
      // Screen Recording (TCC) permission gate for the Chromium binary is a
      // separate check this flag does not satisfy. See the second test
      // below for what that means for this spec in practice.
      "--auto-select-desktop-capture-source=Entire screen",
      "--use-fake-ui-for-media-stream",
    ],
  })

  let [sw] = context.serviceWorkers()
  if (!sw) sw = await context.waitForEvent("serviceworker")
  const extId = new URL(sw.url()).host

  const popup = await context.newPage()
  await popup.goto(`chrome-extension://${extId}/index.html`)
  await popup.evaluate(
    async ({ origin }) => {
      await chrome.storage.local.set({
        configs: [
          {
            id: "widget-modes-1",
            label: "widget-modes test",
            origin,
            projectKey: "rp_pk_" + "a".repeat(24),
            intakeEndpoint: "https://repro.example.com",
            createdAt: Date.now(),
          },
        ],
      })
    },
    { origin: testOrigin },
  )
  await popup.close()

  const page = await context.newPage()
  const cdp = await context.newCDPSession(page)
  await cdp.send("DOM.enable")

  return { context, page, cdp }
}

function startFixtureServer(): Promise<{
  server: ReturnType<typeof createServer>
  origin: string
}> {
  const server = createServer((_, res) => {
    res.setHeader("Content-Type", "text/html")
    res.end(FIXTURE)
  })
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (typeof address !== "object" || address === null) {
        reject(new Error("no address"))
        return
      }
      resolve({ server, origin: `http://127.0.0.1:${address.port}` })
    })
  })
}

test("widget modes: launcher opens the menu; Record screen renders the control bar", async () => {
  test.setTimeout(30_000)
  const { server, origin: testOrigin } = await startFixtureServer()
  const { context, page, cdp } = await setupExtensionContext(testOrigin)

  try {
    await page.goto(testOrigin)

    // --- Host mounts (DOM-level, matches the existing inject.e2e.ts pattern)
    const host = page.locator("#repro-host")
    await expect(host).toBeAttached({ timeout: 10_000 })

    // --- Launcher click opens the menu with its options
    const launcher = await waitForNode(cdp, (n) => hasClass(n, "ft-launcher"), {
      label: "launcher button",
    })
    await click(cdp, page, launcher)

    const menu = await waitForNode(
      cdp,
      (n) => n.nodeName === "DIV" && attrOf(n, "class")?.startsWith("ft-menu pos-") === true,
      { label: "menu popover" },
    )
    expect(menu).toBeDefined()

    const menuNodes = await flat(cdp)
    const rows = menuNodes.filter((n) => hasClass(n, "ft-menu-row"))
    const rowLabels = rows.map((r) => textOf(menuNodes, r).trim())
    // The widget-modes menu exposes four rows: Capture, Record screen,
    // Report bug, and Gallery (packages/ui/src/menu.tsx). The task brief
    // says "three options" — the actual shipped menu has four (Gallery is a
    // fourth row alongside the three original modes). Asserting the real
    // menu contents rather than a stale "three" count. Icon glyphs
    // (📷🎥🐛🖼) precede each row's label text, so match with `includes`
    // rather than `startsWith`.
    expect(rows.length).toBe(4)
    expect(rowLabels.some((l) => l.includes("Capture"))).toBe(true)
    expect(rowLabels.some((l) => l.includes("Record screen"))).toBe(true)
    expect(rowLabels.some((l) => l.includes("Report bug") && !l.includes("with this"))).toBe(true)
    expect(rowLabels.some((l) => l.includes("Gallery"))).toBe(true)

    // --- Click "Record screen" -> control bar appears (this renders
    // optimistically as soon as recording mode starts, before the
    // getDisplayMedia() promise settles — see mount.ts's startRecord()).
    const recordRow = rows.find((r) => textOf(menuNodes, r).trim().includes("Record screen"))
    if (!recordRow) throw new Error("Record screen row not found")
    await click(cdp, page, recordRow)

    const controlBar = await waitForNode(cdp, (n) => hasClass(n, "ft-rec-bar"), {
      timeoutMs: 15_000,
      label: "recording control bar (ft-rec-bar)",
    })
    expect(controlBar).toBeDefined()
    const barNodes = await flat(cdp)
    expect(barNodes.find((n) => hasClass(n, "ft-rec-stop"))).toBeDefined()
    expect(barNodes.find((n) => hasClass(n, "ft-rec-cancel"))).toBeDefined()
    expect(barNodes.find((n) => hasClass(n, "ft-rec-time"))).toBeDefined()
  } finally {
    await context.close()
    server.close()
  }
})

test("widget modes: full record -> trim -> save-to-gallery flow (requires real screen capture)", async () => {
  test.setTimeout(60_000)
  const { server, origin: testOrigin } = await startFixtureServer()
  const { context, page, cdp } = await setupExtensionContext(testOrigin)

  try {
    await page.goto(testOrigin)
    await expect(page.locator("#repro-host")).toBeAttached({ timeout: 10_000 })

    const launcher = await waitForNode(cdp, (n) => hasClass(n, "ft-launcher"), {
      label: "launcher button",
    })
    await click(cdp, page, launcher)
    const menuNodes = await flat(cdp)
    const recordRow = menuNodes.find(
      (n) => hasClass(n, "ft-menu-row") && textOf(menuNodes, n).trim().includes("Record screen"),
    )
    if (!recordRow) throw new Error("Record screen row not found")
    await click(cdp, page, recordRow)

    await waitForNode(cdp, (n) => hasClass(n, "ft-rec-bar"), {
      timeoutMs: 15_000,
      label: "recording control bar (ft-rec-bar)",
    })

    // Give getDisplayMedia's promise time to settle one way or the other:
    // either the recording stays live (ft-rec-bar persists, timer ticks) or
    // the widget fails open back to the menu with an
    // "Screen recording unavailable" toast (packages/ui/src/mount.ts:294,
    // hit when startScreenRecording()'s getDisplayMedia() call rejects).
    await page.waitForTimeout(3_000)

    const settled = await flat(cdp)
    const stillRecording = settled.find((n) => hasClass(n, "ft-rec-stop"))
    const failToast = settled.find((n) => hasClass(n, "ft-mode-toast"))

    if (!stillRecording && failToast) {
      const toastText = textOf(settled, failToast)
      test.skip(
        true,
        `getDisplayMedia() was rejected in this sandbox (widget's own fail-open toast: ` +
          `"${toastText}"). This is a macOS Screen Recording (TCC) permission gate on the ` +
          `Chromium binary Playwright launches — --auto-select-desktop-capture-source only ` +
          `bypasses Chrome's in-app source picker, not the OS-level permission check, and ` +
          `granting that permission requires a one-time interactive System Settings grant per ` +
          `binary (not scriptable, and out of scope to modify on a shared dev machine). The ` +
          `widget's fail-open behavior itself is confirmed working — see the sibling test for ` +
          `the reliably-reproducible portion of this flow (menu + control bar). The actual ` +
          `record -> trim -> save flow is covered by Task 8's manual pass on a real browser ` +
          `with the permission granted, per the task brief's carve-out for interactive ` +
          `screen-share testing.`,
      )
    }

    if (!stillRecording)
      throw new Error("recording stopped for an unexpected reason (no toast either)")

    // --- Click Stop -> trim screen appears
    const stopNode = await waitForNode(cdp, (n) => hasClass(n, "ft-rec-stop"), {
      label: "stop button",
    })
    await click(cdp, page, stopNode)

    const trimScreen = await waitForNode(cdp, (n) => hasClass(n, "ft-trim"), {
      timeoutMs: 15_000,
      label: "trim screen (ft-trim)",
    })
    expect(trimScreen).toBeDefined()
    const trimNodes = await flat(cdp)
    const confirmBtn = trimNodes.find(
      (n) => hasClass(n, "ft-btn-primary") && textOf(trimNodes, n).trim() === "Confirm",
    )
    expect(confirmBtn).toBeDefined()

    // --- Click Confirm -> outcome bar appears
    if (!confirmBtn) throw new Error("Confirm button not found")
    await click(cdp, page, confirmBtn)

    const outcomeBar = await waitForNode(cdp, (n) => hasClass(n, "ft-outcome-bar"), {
      label: "outcome bar (ft-outcome-bar)",
    })
    expect(attrOf(outcomeBar, "data-kind")).toBe("video")
    const outcomeNodes = await flat(cdp)
    const saveBtn = outcomeNodes.find(
      (n) =>
        hasClass(n, "ft-btn-secondary") && textOf(outcomeNodes, n).trim() === "Save to gallery",
    )
    expect(saveBtn).toBeDefined()

    // --- Click "Save to gallery"
    if (!saveBtn) throw new Error("Save to gallery button not found")
    await click(cdp, page, saveBtn)
    await waitForNode(cdp, (n) => !hasClass(n, "ft-outcome-bar"), {
      timeoutMs: 10_000,
      label: "outcome bar dismissed after save",
    }).catch(() => {})

    // --- Reopen the menu -> Gallery -> exactly one video tile
    const launcher2 = await waitForNode(cdp, (n) => hasClass(n, "ft-launcher"), {
      label: "launcher button (reopen)",
    })
    await click(cdp, page, launcher2)

    const menuNodes2 = await flat(cdp)
    const galleryRow = menuNodes2.find(
      (n) => hasClass(n, "ft-menu-row") && textOf(menuNodes2, n).trim().includes("Gallery"),
    )
    if (!galleryRow) throw new Error("Gallery row not found")
    await click(cdp, page, galleryRow)

    await waitForNode(cdp, (n) => hasClass(n, "ft-gallery"), { label: "gallery view" })
    const galleryNodes = await flat(cdp)
    const tiles = galleryNodes.filter((n) => hasClass(n, "ft-gallery-tile"))
    expect(tiles.length).toBe(1)
    expect(attrOf(tiles[0] as CdpNode, "data-kind")).toBe("video")
  } finally {
    await context.close()
    server.close()
  }
})
