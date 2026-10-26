import type { CDPSession, Page } from "@playwright/test"

// ---------------------------------------------------------------------------
// The widget mounts inside a ShadowRoot with mode: "closed" (packages/ui/src
// /shadow.ts), so Playwright's own locator engine cannot see or interact
// with anything past #repro-host — confirmed empirically: page.getByRole(),
// page.locator(".ft-launcher"), and locator.ariaSnapshot() all fail to find
// widget-internal elements, even though host.shadowRoot === null proves the
// closure is real (inject.e2e.ts only ever asserts on #repro-host for
// exactly this reason).
//
// Chrome DevTools Protocol, however, operates at the render-engine level
// (it's what powers DevTools' own Elements panel showing closed shadow
// content) and is unaffected by the JS-facing `shadowRoot` restriction.
// `DOM.getFlattenedDocument({ pierce: true })` returns every node including
// closed-shadow descendants, and `DOM.getBoxModel` gives real viewport
// coordinates for them. Combining that with `page.mouse.click(x, y)` — a
// genuinely trusted mouse event dispatched at real screen coordinates,
// required for getDisplayMedia's user-activation gate — lets specs drive
// the actual widget UI and assert on real structure/text instead of
// falling back to screenshot diffing. Every helper below is a CDP node
// query, not a Playwright locator.
// ---------------------------------------------------------------------------

export interface CdpNode {
  nodeId: number
  parentId?: number
  backendNodeId: number
  nodeType: number
  nodeName: string
  localName?: string
  nodeValue: string
  attributes?: string[]
}

export function attrOf(node: CdpNode, name: string): string | undefined {
  const a = node.attributes
  if (!a) return undefined
  const i = a.indexOf(name)
  return i >= 0 && i % 2 === 0 ? a[i + 1] : undefined
}

export function hasClass(node: CdpNode, cls: string): boolean {
  const c = attrOf(node, "class")
  return Boolean(c && c.split(/\s+/).includes(cls))
}

/** Concatenate the text of every #text descendant of `root` in document
 * order, walking the flat node list via parentId (DOM.getFlattenedDocument
 * doesn't nest `children` the way DOM.getDocument does). Recursive
 * (pre-order) rather than an explicit LIFO stack — a stack that pushes all
 * children then pops visits them in reverse, scrambling sibling order. */
export function textOf(nodes: CdpNode[], root: CdpNode): string {
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

export async function flat(cdp: CDPSession): Promise<CdpNode[]> {
  const doc = await cdp.send("DOM.getFlattenedDocument", { depth: -1, pierce: true })
  return doc.nodes as CdpNode[]
}

export async function centerOf(cdp: CDPSession, node: CdpNode): Promise<{ x: number; y: number }> {
  const box = await cdp.send("DOM.getBoxModel", { nodeId: node.nodeId })
  const [x1, y1, x2, y2, x3, y3, x4, y4] = box.model.content
  return { x: (x1 + x2 + x3 + x4) / 4, y: (y1 + y2 + y3 + y4) / 4 }
}

export async function click(cdp: CDPSession, page: Page, node: CdpNode): Promise<void> {
  const { x, y } = await centerOf(cdp, node)
  await page.mouse.click(x, y)
}

/** Poll `DOM.getFlattenedDocument` until `predicate` finds a node, or throw
 * after `timeoutMs`. Standing in for Playwright's own auto-waiting locators,
 * which don't work here (see header comment). */
export async function waitForNode(
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

/** Finds the button whose visible text is exactly `label` (trimmed). */
export async function waitForButton(
  cdp: CDPSession,
  label: string,
  opts: { timeoutMs?: number } = {},
): Promise<CdpNode> {
  return waitForNode(cdp, (n, all) => n.nodeName === "BUTTON" && textOf(all, n).trim() === label, {
    ...opts,
    label: `button "${label}"`,
  })
}
