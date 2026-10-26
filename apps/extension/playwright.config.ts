import { defineConfig } from "@playwright/test"

// Every run leaves a checkable artifact under test-results/: an HTML report
// (test-results/html) plus a per-test trace.zip written by the specs
// themselves (they launch a persistent context by hand, so the `trace` use
// option would not apply). Open a trace with `bunx playwright show-trace`.
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.e2e.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  outputDir: "./test-results/artifacts",
  reporter: [["list"], ["html", { outputFolder: "./test-results/html", open: "never" }]],
  use: {
    headless: false,
  },
})
