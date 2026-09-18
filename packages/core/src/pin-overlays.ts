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
// is pinned instead.
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

interface Pin {
  source: Element
  clone: HTMLElement
  rect: DOMRect
  sticky: boolean
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

function pinAt(el: HTMLElement, rect: DOMRect) {
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
      pins.push({
        source,
        clone,
        rect: source.getBoundingClientRect(),
        sticky: position === "sticky",
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
      const pinned = pins.map(({ source, clone: el, rect, sticky }) => {
        let target = el
        if (sticky) {
          target = el.cloneNode(true) as HTMLElement
          el.style.setProperty("opacity", "0", "important")
        }
        pinAt(target, rect)
        return { source, target }
      })
      // Append in document order so an ancestor paints beneath its descendants.
      pinned.sort((a, b) =>
        a.source.compareDocumentPosition(b.source) & a.source.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
      )
      for (const { target } of pinned) clonedRoot.appendChild(target)
    },
  }
}
