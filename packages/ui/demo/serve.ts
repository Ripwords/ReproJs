import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, "..", "..", "..")
const sdkIife = join(repoRoot, "packages", "core", "dist", "repro.iife.js")
const indexHtml = join(here, "index.html")

// A real host-page CSP, copied from a site that hit the "Capturing…" hang.
// The load-bearing part is `img-src 'self' data:` with **no `blob:`** — an
// <img src="blob:..."> is refused under this policy, which is why the SDK
// decodes screenshots with createImageBitmap (no resource load) instead.
// Serve the same demo page under it at /csp to exercise that path.
const STRICT_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self'",
].join("; ")

// Capture is entirely client-side, so a well-formed-but-fake key is enough to
// exercise the screenshot flow. Override with REPRO_DEMO_KEY to submit for
// real against a running dashboard.
const DEMO_KEY = process.env.REPRO_DEMO_KEY ?? "rp_pk_demo00000000000000000000"

function renderPage(html: string, csp: boolean): string {
  const banner = csp
    ? `<div style="padding:10px 16px;background:#7f1d1d;color:#fff;font:600 13px system-ui">
         CSP mode — <code>img-src 'self' data:</code> (no <code>blob:</code>).
         Capture must still work. Before the createImageBitmap fix this hung on “Capturing…”.
       </div>`
    : `<div style="padding:10px 16px;background:#065f46;color:#fff;font:600 13px system-ui">
         No CSP — baseline. Compare against <a href="/csp" style="color:#fff">/csp</a>.
       </div>`
  return html
    .replace(
      "</head>",
      `<script>window.REPRO_DEMO_KEY = ${JSON.stringify(DEMO_KEY)}</script></head>`,
    )
    .replace("<body>", `<body>${banner}`)
}

Bun.serve({
  port: 4000,
  hostname: "localhost",
  async fetch(req) {
    const url = new URL(req.url)
    if (url.pathname === "/" || url.pathname === "/index.html") {
      const body = await readFile(indexHtml, "utf8")
      return new Response(renderPage(body, false), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      })
    }
    if (url.pathname === "/csp") {
      const body = await readFile(indexHtml, "utf8")
      return new Response(renderPage(body, true), {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Security-Policy": STRICT_CSP,
        },
      })
    }
    if (url.pathname === "/sdk.iife.js") {
      try {
        const body = await readFile(sdkIife)
        return new Response(body, {
          headers: { "Content-Type": "application/javascript" },
        })
      } catch {
        return new Response("// Build the SDK first: bun run sdk:build\n", {
          status: 503,
          headers: { "Content-Type": "application/javascript" },
        })
      }
    }
    return new Response("Not found", { status: 404 })
  },
})

console.info("Repro demo playground:")
console.info("  baseline (no CSP):  http://localhost:4000/")
console.info("  strict CSP:         http://localhost:4000/csp   ← the reported bug's policy")
