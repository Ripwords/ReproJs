import { chromium, expect, test } from "@playwright/test"
import type { BrowserContext } from "@playwright/test"
import { createServer } from "node:http"
import type { Server } from "node:http"
import { readFileSync, mkdtempSync } from "node:fs"
import { dirname, resolve as resolvePath } from "node:path"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const EXT_PATH = resolvePath(__dirname, "../../dist-e2e")
const FIXTURE = readFileSync(resolvePath(__dirname, "fixtures/test-site.html"), "utf8")

type Harness = {
  context: BrowserContext
  testOrigin: string
  /** Writes a config for `testOrigin` into the extension's storage. */
  configure: () => Promise<void>
  close: () => Promise<void>
}

// Each test gets its own fixture server, Chrome profile, and extension
// instance so service-worker state (the per-tab dedupe Map) never leaks
// between cases. The trace is written to the test's Playwright output dir
// (test-results/artifacts/<test>/trace.zip) — the context is launched by hand, so the
// `trace` option in playwright.config.ts would not cover it.
async function launch(): Promise<Harness> {
  const server: Server = createServer((_, res) => {
    res.setHeader("Content-Type", "text/html")
    res.end(FIXTURE)
  })
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done))
  const address = server.address()
  if (typeof address !== "object" || address === null) throw new Error("no address")
  const testOrigin = `http://127.0.0.1:${address.port}`

  const userDataDir = mkdtempSync(resolvePath(tmpdir(), "repro-ext-"))
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${EXT_PATH}`,
      `--load-extension=${EXT_PATH}`,
      "--no-sandbox",
    ],
  })
  await context.tracing.start({ screenshots: true, snapshots: true })

  const configure = async (): Promise<void> => {
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
              id: "test-1",
              label: "test",
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
  }

  const close = async (): Promise<void> => {
    await context.tracing.stop({ path: test.info().outputPath("trace.zip") })
    await context.close()
    server.close()
  }

  return { context, testOrigin, configure, close }
}

/** Calls Repro.open() in the page and reports whether it threw. The widget
 * renders in a closed shadow root, so "did not throw" is the observable
 * contract for "window.Repro is the initialised instance". */
async function openThrows(page: import("@playwright/test").Page): Promise<string | null> {
  return page.evaluate(() => {
    const g = globalThis as unknown as { Repro?: { open: () => void; close: () => void } }
    try {
      g.Repro?.open()
      g.Repro?.close()
      return null
    } catch (err) {
      return err instanceof Error ? err.message : String(err)
    }
  })
}

test("injects the SDK on a configured origin", async () => {
  const h = await launch()
  try {
    await h.configure()
    const page = await h.context.newPage()
    await page.goto(h.testOrigin)
    const host = page.locator("#repro-host")
    await expect(host).toBeAttached({ timeout: 10_000 })
  } finally {
    await h.close()
  }
})

test("does NOT inject on an unconfigured origin", async () => {
  const h = await launch()
  try {
    const page = await h.context.newPage()
    await page.goto(h.testOrigin)
    await page.waitForTimeout(2000)
    const host = page.locator("#repro-host")
    await expect(host).toHaveCount(0)
  } finally {
    await h.close()
  }
})

test("re-injects after a page reload and does not duplicate the host", async () => {
  const h = await launch()
  try {
    await h.configure()
    const page = await h.context.newPage()
    await page.goto(h.testOrigin)
    await expect(page.locator("#repro-host")).toBeAttached({ timeout: 10_000 })

    // The page world is wiped by the reload while the service worker keeps
    // its dedupe Map. A stale entry here means no launcher after F5.
    await page.reload()
    await expect(page.locator("#repro-host")).toBeAttached({ timeout: 10_000 })
    // Give the fallback `complete` trigger time to fire too; it must not
    // mount a second host.
    await page.waitForTimeout(1500)
    await expect(page.locator("#repro-host")).toHaveCount(1)
    expect(await openThrows(page)).toBeNull()
  } finally {
    await h.close()
  }
})

test("keeps the initialised SDK across a pushState navigation", async () => {
  const h = await launch()
  try {
    await h.configure()
    const page = await h.context.newPage()
    await page.goto(h.testOrigin)
    await expect(page.locator("#repro-host")).toBeAttached({ timeout: 10_000 })
    expect(await openThrows(page)).toBeNull()

    // SPA route change: same document, new URL. tabs.onUpdated reports the
    // URL change, the service worker clears its dedupe slot and runs the
    // inject chain again. Re-evaluating the IIFE here would replace
    // window.Repro with an uninitialised module.
    await page.evaluate(() => history.pushState({}, "", "/settings/profile"))
    await page.waitForTimeout(2000)

    await expect(page.locator("#repro-host")).toHaveCount(1)
    expect(await openThrows(page)).toBeNull()
  } finally {
    await h.close()
  }
})
