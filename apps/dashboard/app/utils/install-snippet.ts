/**
 * The embed snippets shown on the project Overview, the project Security tab
 * and the admin Install page. One builder so every surface shows the same
 * `async` + `onload` form with the project's real key and the dashboard's
 * real origin — previously the Security tab had its own (racy, synchronous)
 * copy and the Install page used a fake key.
 */

export const PROJECT_KEY_PLACEHOLDER = "rp_pk_xxxxxxxxxxxxxxxxxxxxxxxx"

export interface SnippetInput {
  /** Dashboard origin, e.g. `https://repro.example.com`. */
  origin: string
  /** The project's public key, or null when the project has none yet. */
  projectKey: string | null
}

/** Reduce any URL-ish string to its origin (`scheme://host[:port]`). */
export function normalizeOrigin(raw: string): string {
  try {
    return new URL(raw).origin
  } catch {
    return raw
  }
}

// `onload` ties the init call to the bundle's own load completion — without
// it, an async script + separate inline init race, and the inline often runs
// first with "Repro is not defined". See docs/guide/sdk.md for the trade-off
// and a synchronous alternative.
export function buildScriptSnippet({ origin, projectKey }: SnippetInput): string {
  const o = normalizeOrigin(origin)
  const key = projectKey ?? PROJECT_KEY_PLACEHOLDER
  return [
    "<script",
    `  src="${o}/sdk/repro.iife.js"`,
    "  async",
    `  onload="Repro.init({ projectKey: '${key}', endpoint: '${o}' })"`,
    "></script>",
  ].join("\n")
}

export function buildInitSnippet({ origin, projectKey }: SnippetInput): string {
  const o = normalizeOrigin(origin)
  const key = projectKey ?? PROJECT_KEY_PLACEHOLDER
  return [
    'import { init } from "@reprojs/core"',
    "",
    "init({",
    `  projectKey: "${key}",`,
    `  endpoint: "${o}",`,
    "})",
  ].join("\n")
}
