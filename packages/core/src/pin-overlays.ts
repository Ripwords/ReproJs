// modern-screenshot's restoreScrollPosition shifts the children of every
// scrolled element with a CSS transform. A transformed ancestor becomes the
// containing block for position:fixed descendants, and the clone is never
// scrolled so sticky descendants sit at their unstuck spot — either way they
// get shifted out of frame with the content. A fixed sidebar or sticky header
// on a scrolled page vanishes from the capture.
//
// This pins each such element back to where it is on screen: the clone is
// re-parented under the cloned root at its live rect. A sticky element still
// holds space in the flow, so its original stays behind, invisible, and a copy
// is pinned instead. Moved out from under its scroll boxes, a pinned element is
// no longer clipped by them, so it carries their clip with it; and it leaves
// table layout, so a cell keeps its vertical alignment by becoming a flex box.
//
// modern-screenshot hands its hooks the clone but not the source, so the
// pairing relies on its traversal: `filter` sees each source child just before
// it is cloned, and `onCloneEachNode` fires once that clone's subtree is done
// (post-order). A stack of filtered elements therefore pops in step with the
// clones. The root is never filtered; it is what pops off an empty stack.

export interface OverlayPinner {
  filter: (node: Node) => boolean
  onCloneEachNode: (cloned: Node) => void
  onCloneNode: (clone: Node) => void
}

interface Box {
  top: number
  left: number
  right: number
  bottom: number
}

interface Pin {
  source: Element
  clone: HTMLElement
  rect: DOMRect
  // The part of `rect` its scroll boxes leave on screen; null when none is.
  visible: Box | null
  sticky: boolean
  // Set for a table cell: where its content sits in the flex box it becomes.
  justify: string | null
}

function isElement(node: Node): node is Element {
  return node.nodeType === 1
}

function parentAcrossShadow(el: Element): Element | null {
  if (el.parentElement) return el.parentElement
  const parent = el.parentNode
  return parent && "host" in parent ? (parent as ShadowRoot).host : null
}

function hasScrolledAncestor(el: Element): boolean {
  for (let a = parentAcrossShadow(el); a; a = parentAcrossShadow(a)) {
    if (a.scrollTop || a.scrollLeft) return true
  }
  return false
}

function styleOf(el: Element): CSSStyleDeclaration | null {
  return el.ownerDocument.defaultView?.getComputedStyle(el) ?? null
}

// A sticky element is clipped by every overflow box it sits in, up to the
// first fixed ancestor (the boxes above that one don't clip it).
function visibleBox(source: Element, rect: DOMRect): Box | null {
  const box = { top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom }
  for (let a = parentAcrossShadow(source); a; a = parentAcrossShadow(a)) {
    const style = styleOf(a)
    if (!style) break
    const clipsX = style.overflowX !== "visible" && style.overflowX !== ""
    const clipsY = style.overflowY !== "visible" && style.overflowY !== ""
    if (clipsX || clipsY) {
      // The padding box: inside the borders, and clientWidth leaves out any
      // scrollbar, as the live clip does.
      const r = a.getBoundingClientRect()
      const left = r.left + a.clientLeft
      const top = r.top + a.clientTop
      if (clipsX) {
        box.left = Math.max(box.left, left)
        box.right = Math.min(box.right, left + (a.clientWidth || r.width))
      }
      if (clipsY) {
        box.top = Math.max(box.top, top)
        box.bottom = Math.min(box.bottom, top + (a.clientHeight || r.height))
      }
    }
    if (style.position === "fixed") break
  }
  return box.right > box.left && box.bottom > box.top ? box : null
}

function cellJustify(source: Element): string | null {
  const style = styleOf(source)
  if (style?.display !== "table-cell") return null
  if (style.verticalAlign === "middle") return "center"
  if (style.verticalAlign === "bottom") return "flex-end"
  return "flex-start"
}

function pinAt(el: HTMLElement, rect: DOMRect, visible: Box, justify: string | null) {
  const set = (name: string, value: string) => el.style.setProperty(name, value, "important")
  set("position", "absolute")
  set("top", `${rect.top}px`)
  set("left", `${rect.left}px`)
  set("right", "auto")
  set("bottom", "auto")
  set("margin", "0")
  set("box-sizing", "border-box")
  set("width", `${rect.width}px`)
  set("height", `${rect.height}px`)
  // The rect already includes the element's own transform.
  set("transform", "none")
  set("translate", "none")
  set("rotate", "none")
  set("scale", "none")
  const cut = [
    visible.top - rect.top,
    rect.right - visible.right,
    rect.bottom - visible.bottom,
    visible.left - rect.left,
  ]
  if (cut.some((px) => px > 0)) {
    set("clip-path", `inset(${cut.map((px) => `${Math.max(0, px)}px`).join(" ")})`)
  }
  if (justify) {
    set("display", "flex")
    set("flex-direction", "column")
    set("justify-content", justify)
  }
}

export function createOverlayPinner(root: Element, filter: (node: Node) => boolean): OverlayPinner {
  const pending: Element[] = []
  // An <iframe>'s clone is its document's <html>, and modern-screenshot reports
  // that clone twice. Only the first report may pop.
  const paired = new WeakSet<Node>()
  const pins: Pin[] = []

  return {
    filter(node) {
      const keep = filter(node)
      if (keep && isElement(node)) pending.push(node)
      return keep
    },

    onCloneEachNode(cloned) {
      if (!isElement(cloned) || paired.has(cloned)) return
      paired.add(cloned)
      const source = pending.pop() ?? root
      const clone = cloned as HTMLElement
      const position = clone.style?.position
      if (position !== "fixed" && position !== "sticky") return
      // A canvas clones to an <img>, an iframe to <html>: not a reliable pair.
      if (source.localName !== clone.localName) return
      if (!hasScrolledAncestor(source)) return
      const rect = source.getBoundingClientRect()
      const sticky = position === "sticky"
      pins.push({
        source,
        clone,
        rect,
        // A fixed element escapes its ancestors' overflow clip.
        visible: sticky
          ? visibleBox(source, rect)
          : { top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom },
        sticky,
        justify: cellJustify(source),
      })
    },

    onCloneNode(clone) {
      if (pins.length === 0 || !isElement(clone)) return
      const clonedRoot = clone as HTMLElement
      if (!clonedRoot.style.position || clonedRoot.style.position === "static") {
        clonedRoot.style.setProperty("position", "relative")
      }
      // Pins arrive deepest-first, so a sticky child is hidden and copied out
      // before any ancestor is copied with it.
      const pinned = pins.flatMap(({ source, clone: el, rect, visible, sticky, justify }) => {
        let target = el
        if (sticky) {
          target = el.cloneNode(true) as HTMLElement
          el.style.setProperty("opacity", "0", "important")
        }
        // Scrolled wholly out of its box: the live page shows none of it.
        if (!visible) return []
        pinAt(target, rect, visible, justify)
        return [{ source, target }]
      })
      // Append in document order so an ancestor paints beneath its descendants.
      pinned.sort((a, b) =>
        a.source.compareDocumentPosition(b.source) & a.source.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
      )
      for (const { target } of pinned) clonedRoot.appendChild(target)
    },
  }
}
