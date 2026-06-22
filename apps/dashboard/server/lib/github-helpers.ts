const BACKOFF_MS = [10_000, 30_000, 120_000, 600_000, 3_600_000] as const

/**
 * TTL for the signed screenshot URL embedded in a GitHub issue body.
 *
 * GitHub issues are permanent and GitHub proxies embedded images through its
 * Camo cache, which re-fetches the source long after the issue was created
 * (cache eviction, first view of an old issue, etc.). A short TTL therefore
 * meant every issue older than the TTL rendered a broken image the moment Camo
 * re-requested it — a previous 7-day value made this surface ~1 week after each
 * report. The token is HMAC-scoped to a single (project, report, screenshot),
 * so an effectively-permanent expiry is the correct lifetime for an embed in a
 * permanent document. 100 years ≈ permanent for any realistic deployment.
 */
export const GITHUB_EMBED_SCREENSHOT_TTL_SECONDS = 100 * 365 * 24 * 60 * 60

export function computeBackoff(attempts: number): number {
  const idx = Math.max(0, Math.min(attempts - 1, BACKOFF_MS.length - 1))
  return BACKOFF_MS[idx] ?? BACKOFF_MS[0]
}

export interface LabelsForReport {
  priority: "low" | "normal" | "high" | "urgent"
  tags: readonly string[]
}

export interface LabelsForIntegration {
  defaultLabels: readonly string[]
}

export function labelsFor(report: LabelsForReport, integration: LabelsForIntegration): string[] {
  const seen = new Set<string>()
  const add = (s: string) => {
    if (!seen.has(s)) seen.add(s)
  }
  for (const l of integration.defaultLabels) add(l)
  add(`priority:${report.priority}`)
  for (const t of report.tags) add(t)
  return [...seen].toSorted()
}

export interface ParsedLabelSync {
  /** null = no priority:* label present; caller should leave priority unchanged */
  priority: LabelsForReport["priority"] | null
  tags: string[]
}

/**
 * Converts the full GitHub label set on an issue back to dashboard-native fields.
 * defaultLabels are skipped (they are project-level metadata, not report tags).
 * priority:* labels are extracted into the priority field.
 */
export function parseGithubLabels(
  issueLabels: string[],
  defaultLabels: readonly string[],
): ParsedLabelSync {
  const defaultSet = new Set(defaultLabels)
  let priority: LabelsForReport["priority"] | null = null
  const tags: string[] = []

  for (const label of issueLabels) {
    if (defaultSet.has(label)) continue
    const m = label.match(/^priority:(low|normal|high|urgent)$/)
    if (m) {
      priority = m[1] as LabelsForReport["priority"]
      continue
    }
    tags.push(label)
  }

  return { priority, tags }
}

export interface SystemInfoShape {
  userAgent: string
  platform: string
  language: string
  timezone: string
  timezoneOffset: number
  viewport: { w: number; h: number }
  screen: { w: number; h: number }
  dpr: number
  online: boolean
  connection?: { effectiveType?: string; rtt?: number; downlink?: number }
  referrer?: string
}

export interface ConsoleEntryShape {
  level: "log" | "info" | "warn" | "error" | "debug"
  ts: number
  args: readonly string[]
  stack?: string
}

export interface NetworkEntryShape {
  ts: number
  method: string
  url: string
  status: number | null
  durationMs: number | null
  error?: string
}

export interface BreadcrumbShape {
  ts: number
  event: string
  level: "debug" | "info" | "warn" | "error"
  data?: Record<string, string | number | boolean | null>
}

export interface CookieShape {
  name: string
  value: string
}

export interface BuildIssueBodyInput {
  id: string
  title: string
  description: string
  pageUrl: string
  reporterEmail: string | null
  createdAt: Date
  screenshotUrl: string | null
  dashboardUrl: string
  systemInfo?: SystemInfoShape
  metadata?: Record<string, string | number | boolean>
  console?: readonly ConsoleEntryShape[]
  network?: readonly NetworkEntryShape[]
  breadcrumbs?: readonly BreadcrumbShape[]
  cookies?: readonly CookieShape[]
}

const MAX_BODY = 60_000
const MAX_LOG_ENTRIES = 25
const MAX_LINE = 500

export function reportMarker(reportId: string): string {
  return `repro:report:${reportId}`
}

function fmtUtc(d: Date): string {
  const iso = d.toISOString()
  return `${iso.slice(0, 16).replace("T", " ")} UTC`
}

function fmtTs(ts: number): string {
  const d = new Date(ts)
  return `${d.toISOString().slice(11, 23)}Z`
}

function clip(s: string, n: number = MAX_LINE): string {
  if (s.length <= n) return s
  return `${s.slice(0, n)}… (+${s.length - n}ch)`
}

function fence(content: string, lang = ""): string {
  return `\`\`\`${lang}\n${content}\n\`\`\``
}

function details(summary: string, body: string): string {
  return `<details><summary>${summary}</summary>\n\n${body}\n\n</details>`
}

function renderEnvironment(s: SystemInfoShape): string {
  const lines: string[] = []
  lines.push(`- **User agent:** ${clip(s.userAgent, 200)}`)
  lines.push(`- **Platform:** ${s.platform}`)
  lines.push(
    `- **Viewport:** ${s.viewport.w}×${s.viewport.h}  **Screen:** ${s.screen.w}×${s.screen.h}  **DPR:** ${s.dpr}`,
  )
  const tz = s.timezoneOffset >= 0 ? `+${s.timezoneOffset / 60}` : `${s.timezoneOffset / 60}`
  lines.push(`- **Language:** ${s.language}  **Timezone:** ${s.timezone} (UTC${tz})`)
  const net: string[] = [`online=${s.online}`]
  if (s.connection?.effectiveType) net.push(`type=${s.connection.effectiveType}`)
  if (s.connection?.rtt != null) net.push(`rtt=${s.connection.rtt}ms`)
  if (s.connection?.downlink != null) net.push(`down=${s.connection.downlink}Mbps`)
  lines.push(`- **Connection:** ${net.join(", ")}`)
  if (s.referrer) lines.push(`- **Referrer:** ${clip(s.referrer, 200)}`)
  return lines.join("\n")
}

function renderMetadata(m: Record<string, string | number | boolean>): string {
  return Object.entries(m)
    .map(([k, v]) => `- **${k}:** ${String(v)}`)
    .join("\n")
}

function renderConsole(entries: readonly ConsoleEntryShape[]): string {
  const recent = entries.slice(-MAX_LOG_ENTRIES)
  const hidden = entries.length - recent.length
  const lines = recent.map((e) => {
    const args = e.args.map((a) => clip(a, 300)).join(" ")
    const stack = e.stack ? `\n    ${clip(e.stack.split("\n").slice(0, 4).join(" | "), 400)}` : ""
    return `[${fmtTs(e.ts)}] ${e.level.toUpperCase().padEnd(5)} ${args}${stack}`
  })
  const body = fence(lines.join("\n"))
  const header =
    hidden > 0
      ? `Console (showing last ${recent.length} of ${entries.length})`
      : `Console (${entries.length})`
  return details(header, body)
}

function renderNetwork(entries: readonly NetworkEntryShape[]): string {
  const recent = entries.slice(-MAX_LOG_ENTRIES)
  const hidden = entries.length - recent.length
  const lines = recent.map((e) => {
    const status = e.status == null ? "---" : String(e.status)
    const dur = e.durationMs == null ? "—" : `${Math.round(e.durationMs)}ms`
    const err = e.error ? `  ERROR: ${clip(e.error, 150)}` : ""
    return `[${fmtTs(e.ts)}] ${e.method.padEnd(6)} ${status.padEnd(4)} ${dur.padEnd(8)} ${clip(e.url, 200)}${err}`
  })
  const body = fence(lines.join("\n"))
  const header =
    hidden > 0
      ? `Network (showing last ${recent.length} of ${entries.length})`
      : `Network (${entries.length})`
  return details(header, body)
}

function renderBreadcrumbs(entries: readonly BreadcrumbShape[]): string {
  const recent = entries.slice(-MAX_LOG_ENTRIES)
  const hidden = entries.length - recent.length
  const lines = recent.map((e) => {
    const data = e.data ? ` ${JSON.stringify(e.data)}` : ""
    return `[${fmtTs(e.ts)}] ${e.level.toUpperCase().padEnd(5)} ${e.event}${clip(data, 200)}`
  })
  const body = fence(lines.join("\n"))
  const header =
    hidden > 0
      ? `Breadcrumbs (showing last ${recent.length} of ${entries.length})`
      : `Breadcrumbs (${entries.length})`
  return details(header, body)
}

function renderCookies(entries: readonly CookieShape[]): string {
  const lines = entries.map((c) => `${c.name}=${clip(c.value, 80)}`)
  return details(`Cookies (${entries.length})`, fence(lines.join("\n")))
}

export function buildIssueBody(input: BuildIssueBodyInput): string {
  const parts: string[] = []
  const reporter = input.reporterEmail ? `**${input.reporterEmail}**` : "anonymous"
  parts.push(`> Reported by ${reporter} via Repro`)
  if (input.pageUrl) parts.push(`> Page: ${input.pageUrl}`)
  parts.push(`> Captured: ${fmtUtc(input.createdAt)}`)
  parts.push("")
  parts.push("## Description")
  parts.push("")
  parts.push(input.description || "_(no description)_")
  if (input.screenshotUrl) {
    parts.push("")
    parts.push(`![Screenshot](${input.screenshotUrl})`)
  }

  if (input.systemInfo) {
    parts.push("")
    parts.push("## Environment")
    parts.push("")
    parts.push(renderEnvironment(input.systemInfo))
  }

  if (input.metadata && Object.keys(input.metadata).length > 0) {
    parts.push("")
    parts.push("## Metadata")
    parts.push("")
    parts.push(renderMetadata(input.metadata))
  }

  const sections: string[] = []
  if (input.console && input.console.length > 0) sections.push(renderConsole(input.console))
  if (input.network && input.network.length > 0) sections.push(renderNetwork(input.network))
  if (input.breadcrumbs && input.breadcrumbs.length > 0)
    sections.push(renderBreadcrumbs(input.breadcrumbs))
  if (input.cookies && input.cookies.length > 0) sections.push(renderCookies(input.cookies))

  if (sections.length > 0) {
    parts.push("")
    parts.push("## Diagnostics")
    parts.push("")
    parts.push(sections.join("\n\n"))
  }

  parts.push("")
  parts.push("---")
  parts.push("")
  parts.push(`<sub>Replay, attachments and full history: ${input.dashboardUrl}</sub>`)
  // Hidden idempotency marker — used by reconcile to detect half-created issues
  // on retry without producing duplicates.
  parts.push("")
  parts.push(`<!-- ${reportMarker(input.id)} -->`)

  const body = parts.join("\n")
  if (body.length <= MAX_BODY) return body
  const marker = `\n\n<!-- ${reportMarker(input.id)} -->`
  return `${body.slice(0, MAX_BODY - 200 - marker.length)}\n\n_(…body truncated — open in dashboard for full detail)_\n\n<sub>${input.dashboardUrl}</sub>${marker}`
}
