import { existsSync } from "node:fs"
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const CORE_DIR = resolve(__dirname, "../../../packages/core")
const SRC = resolve(CORE_DIR, "dist/repro.iife.js")
const DEST = resolve(__dirname, "../public/repro.iife.js")
// Read by the service worker at inject time and logged from the page world
// so a tester's console shows which SDK build the extension carries. This
// copies whatever sits in packages/core/dist — a stale local build ships a
// stale SDK — so the version is recorded here and printed on every boot.
const VERSION_DEST = resolve(__dirname, "../public/sdk-version.json")

if (!existsSync(SRC)) {
  console.error(
    `[sync-sdk] Missing ${SRC}.\n` +
      `Run 'bun run sdk:build' from the repo root before building the extension.`,
  )
  process.exit(1)
}

const pkg = JSON.parse(await readFile(resolve(CORE_DIR, "package.json"), "utf8")) as {
  version: string
}

await mkdir(dirname(DEST), { recursive: true })
await copyFile(SRC, DEST)
await writeFile(VERSION_DEST, JSON.stringify({ version: pkg.version }) + "\n")
console.log(`[sync-sdk] Copied @reprojs/core v${pkg.version} IIFE → ${DEST}`)
