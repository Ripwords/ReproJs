/**
 * Lazy, app-wide shiki highlighter. Shiki is ~1MB so it's only imported the
 * first time a snippet is actually rendered, and the instance is cached for
 * the rest of the session.
 *
 * Shiki defaults to an Oniguruma (C→WASM) regex engine for TextMate grammar
 * parsing. That path requires CSP `'wasm-unsafe-eval'` in script-src, which
 * broadens our security headers for the whole app. The JS engine is a
 * pure-JS regex runtime — same API, no WASM, runs inside the default strict
 * CSP. It's a touch slower to parse (~2× on cold start) but imperceptible
 * for the handful of small snippets we render.
 */
export type SnippetLang = "html" | "javascript" | "typescript" | "bash"

export interface HighlightedCode {
  light: string
  dark: string
}

let highlighterPromise: Promise<import("shiki").Highlighter> | null = null

function getHighlighter() {
  if (!highlighterPromise) {
    highlighterPromise = Promise.all([import("shiki"), import("shiki/engine/javascript")]).then(
      ([shiki, js]) =>
        shiki.createHighlighter({
          themes: ["github-light", "github-dark"],
          langs: ["html", "javascript", "typescript", "bash"],
          engine: js.createJavaScriptRegexEngine(),
        }),
    )
  }
  return highlighterPromise
}

export async function highlightCode(code: string, lang: SnippetLang): Promise<HighlightedCode> {
  const h = await getHighlighter()
  return {
    light: h.codeToHtml(code, { lang, theme: "github-light" }),
    dark: h.codeToHtml(code, { lang, theme: "github-dark" }),
  }
}
