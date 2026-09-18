/**
 * Bun test preload file.
 * Checks that the Nuxt dev server is already running at TEST_BASE_URL.
 * Run tests with:   bun run test:e2e
 * which starts the dev server automatically.
 *
 * Set SKIP_SERVER_CHECK=1 (or run pure unit-test files that don't hit the API)
 * to bypass the server readiness check.
 */
const BASE_URL = process.env.TEST_BASE_URL ?? "http://localhost:3000"

// server/lib/env.ts parses once per process, and bun runs every test file in
// one process. tests/api/oauth-signup-gate.test.ts drives an in-process
// better-auth with a stubbed GitHub provider, so the provider must be
// configured before whichever file imports env.ts first. Only affects the
// in-process auth instance, never the dev server under test.
process.env.GITHUB_CLIENT_ID ||= "test-github-client-id"
process.env.GITHUB_CLIENT_SECRET ||= "test-github-client-secret"

async function checkServer(retries = 30, delayMs = 1000): Promise<void> {
  for (let i = 0; i < retries; i++) {
    try {
      // eslint-disable-next-line no-await-in-loop -- sequential retry loop; each attempt must wait before deciding to retry
      const res = await fetch(`${BASE_URL}/api/me`, { signal: AbortSignal.timeout(3000) })
      if (res.status === 401 || res.status === 200) return
    } catch {
      // not ready yet
    }
    if (i < retries - 1) {
      // eslint-disable-next-line no-await-in-loop -- delay between retries must be sequential
      await new Promise((r) => setTimeout(r, delayMs))
    }
  }
  throw new Error(
    `Nuxt dev server not reachable at ${BASE_URL} after ${retries} retries. ` +
      `Start it with: bun run dev`,
  )
}

if (!process.env.SKIP_SERVER_CHECK) {
  await checkServer()
}

// Marks this file as a module so top-level `await` above is valid.
export {}
