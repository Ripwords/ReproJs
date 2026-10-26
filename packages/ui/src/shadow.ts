// packages/ui/src/shadow.ts
//
// The widget mounts inside a ShadowRoot with mode: "closed" so host-page
// scripts cannot reach into the widget via `hostEl.shadowRoot` and read or
// mutate the annotation canvas, in-flight report contents, or form fields.
// Closed mode causes `host.shadowRoot` to resolve to null from outside, so
// we track our own ShadowRoot references in a module-private WeakMap keyed
// by the host element. The returned ShadowRoot reference remains usable by
// internal callers (e.g. mount.ts) exactly as before.
const attachedRoots = new WeakMap<HTMLElement, ShadowRoot>()

export function createShadowHost(): ShadowRoot {
  let host = document.getElementById("repro-host") as HTMLElement | null
  if (!host) {
    host = document.createElement("div")
    host.id = "repro-host"
    document.body.appendChild(host)
  }
  const existing = attachedRoots.get(host)
  if (existing) return existing
  // Two SDK copies on one page (e.g. a host bundle plus the tester
  // extension) both find #repro-host, and the second attachShadow() throws a
  // bare NotSupportedError because the first copy already attached a closed
  // root this module can't see. Replacing the host would tear down the other
  // copy's live widget, so bail with a message that names the cause; core's
  // init() catches it, warns, and leaves the collectors unstarted.
  let root: ShadowRoot
  try {
    root = host.attachShadow({ mode: "closed" })
  } catch (err) {
    throw new Error(
      "[repro] #repro-host already has a shadow root — is another Repro SDK instance on this page?",
      { cause: err },
    )
  }
  attachedRoots.set(host, root)
  return root
}

export function injectStyles(root: ShadowRoot, css: string) {
  const style = document.createElement("style")
  style.textContent = css
  root.appendChild(style)
}

export function unmountShadowHost() {
  const host = document.getElementById("repro-host") as HTMLElement | null
  if (host) {
    attachedRoots.delete(host)
    host.remove()
  }
}
