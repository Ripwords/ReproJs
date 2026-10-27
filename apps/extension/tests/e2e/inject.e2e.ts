import { expect, test } from "@playwright/test"
import { launch, openThrows } from "./harness"

test("injects the SDK on a configured origin", async () => {
  const h = await launch()
  try {
    await h.configure()
    const page = await h.context.newPage()
    const bootLog = page.waitForEvent("console", {
      predicate: (msg) => /\[repro-extension\] Repro SDK v\d+\.\d+\.\d+ booted/.test(msg.text()),
      timeout: 10_000,
    })
    await page.goto(h.testOrigin)
    const host = page.locator("#repro-host")
    await expect(host).toBeAttached({ timeout: 10_000 })
    // The bundled SDK version is recorded by scripts/sync-sdk.ts and must
    // reach the page console, so a tester can tell which build they run.
    expect((await bootLog).text()).not.toContain("unknown")
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

    // SPA route change: same document, new URL. The service worker must
    // leave the already-booted SDK alone — no new document was committed.
    // Re-evaluating the IIFE here would replace window.Repro with an
    // uninitialised module.
    await page.evaluate(() => history.pushState({}, "", "/settings/profile"))
    await page.waitForTimeout(2000)

    await expect(page.locator("#repro-host")).toHaveCount(1)
    expect(await openThrows(page)).toBeNull()
  } finally {
    await h.close()
  }
})
