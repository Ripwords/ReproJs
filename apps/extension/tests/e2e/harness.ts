import { chromium, test } from "@playwright/test"
import type { BrowserContext, Page } from "@playwright/test"
import { createServer } from "node:http"
import type { IncomingMessage, Server, ServerResponse } from "node:http"
import { readFileSync, mkdtempSync } from "node:fs"
import { dirname, resolve as resolvePath } from "node:path"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const EXT_PATH = resolvePath(__dirname, "../../dist-e2e")
const FIXTURE = readFileSync(resolvePath(__dirname, "fixtures/test-site.html"), "utf8")

export type Harness = {
  context: BrowserContext
  /** Origin of the fixture server (serves test-site.html for every path). */
  testOrigin: string
  /** Writes a config for `testOrigin` into the extension's storage. */
  configure: (overrides?: ConfigureOverrides) => Promise<void>
  close: () => Promise<void>
}

export type ConfigureOverrides = {
  intakeEndpoint?: string
  /**
   * Per-origin "Show 'Related GitHub issue' field" toggle. Left out of the
   * stored config when undefined, which is the shape older builds wrote —
   * so the default specs keep exercising storage's legacy normalisation.
   */
  relatedIssueField?: boolean
}

export type LaunchOptions = {
  /**
   * Intercepts fixture-server requests. Return true when the handler took
   * care of the response; false falls through to the HTML fixture.
   */
  handler?: (req: IncomingMessage, res: ServerResponse) => boolean
}

// Each test gets its own fixture server, Chrome profile, and extension
// instance so service-worker state (the per-tab dedupe Map) never leaks
// between cases. The trace is written to the test's Playwright output dir
// (test-results/artifacts/<test>/trace.zip) — the context is launched by
// hand, so the `trace` option in playwright.config.ts would not cover it.
export async function launch(options: LaunchOptions = {}): Promise<Harness> {
  const server: Server = createServer((req, res) => {
    if (options.handler?.(req, res)) return
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

  const configure = async (overrides: ConfigureOverrides = {}): Promise<void> => {
    let [sw] = context.serviceWorkers()
    if (!sw) sw = await context.waitForEvent("serviceworker")
    const extId = new URL(sw.url()).host

    const popup = await context.newPage()
    await popup.goto(`chrome-extension://${extId}/index.html`)
    await popup.evaluate(
      async ({ origin, intakeEndpoint, relatedIssueField }) => {
        await chrome.storage.local.set({
          configs: [
            {
              id: "test-1",
              label: "test",
              origin,
              projectKey: "rp_pk_" + "a".repeat(24),
              intakeEndpoint,
              createdAt: Date.now(),
              ...(relatedIssueField === undefined ? {} : { relatedIssueField }),
            },
          ],
        })
      },
      {
        origin: testOrigin,
        intakeEndpoint: overrides.intakeEndpoint ?? "https://repro.example.com",
        relatedIssueField: overrides.relatedIssueField,
      },
    )
    await popup.close()
  }

  const close = async (): Promise<void> => {
    await context.tracing.stop({ path: test.info().outputPath("trace.zip") })
    await context.close()
    // Hanging intake handlers keep sockets open; drop them so close() returns.
    server.closeAllConnections()
    server.close()
  }

  return { context, testOrigin, configure, close }
}

/** Calls Repro.open() in the page and reports whether it threw. The widget
 * renders in a closed shadow root, so "did not throw" is the observable
 * contract for "window.Repro is the initialised instance". */
export async function openThrows(page: Page): Promise<string | null> {
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
