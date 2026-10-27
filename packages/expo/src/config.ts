import type { ReporterIdentity } from "@reprojs/shared"
import { DEFAULT_SUBMIT_TIMEOUT_MS } from "./intake-client"

/**
 * Byte cap across all queued attachments. Must stay above
 * `DEFAULT_ATTACHMENT_LIMITS.maxTotalBytes` (25 MiB, the most the wizard lets
 * a reporter attach) plus room for the screenshot, otherwise a report that
 * passed every form check is refused at submit time as too large.
 */
export const DEFAULT_QUEUE_MAX_BYTES = 32 * 1024 * 1024

const DEFAULT_HEADER_DENYLIST = ["authorization", "cookie", "x-api-key"]
const DEFAULT_BODY_REDACT_KEYS = ["password", "token", "secret"]
const PROJECT_KEY_PATTERN = /^rp_pk_[A-Za-z0-9]{24}$/

export interface ReproConfigInput {
  projectKey: string
  intakeUrl: string
  reporter?: ReporterIdentity
  collectors?: {
    console?: boolean
    network?: { enabled?: boolean; captureBodies?: boolean }
    breadcrumbs?: boolean
    systemInfo?: boolean
  }
  queue?: {
    maxReports?: number
    maxBytes?: number
    backoffMs?: number[]
    /** Retries before a report is given up on and `onDrop` fires. */
    maxAttempts?: number
    /** Abort one upload attempt after this many milliseconds. Default 60 000. */
    submitTimeoutMs?: number
  }
  redact?: {
    headerDenylist?: string[]
    bodyRedactKeys?: string[]
  }
  theme?: { accent?: string; mode?: "auto" | "light" | "dark" }
  metadata?: Record<string, string | number | boolean>
  /** Optional extra form fields. All off by default. */
  fields?: {
    /**
     * Show an optional "Related GitHub issue" input on the details step so a
     * tester re-testing a known bug can point at it (`#42`, `42`,
     * `owner/repo#42` or the issue URL). The text is sent as a plain hint
     * (`relatedIssue`) that a manager confirms in the dashboard; the app never
     * learns whether the issue exists and never writes to GitHub itself.
     */
    relatedIssue?: boolean
  }
}

export interface ReproConfig {
  projectKey: string
  intakeUrl: string
  reporter: ReporterIdentity | null
  collectors: {
    console: boolean
    network: { enabled: boolean; captureBodies: boolean }
    breadcrumbs: boolean
    systemInfo: boolean
  }
  queue: {
    maxReports: number
    maxBytes: number
    backoffMs: number[]
    maxAttempts: number
    submitTimeoutMs: number
  }
  redact: {
    headerDenylist: string[]
    bodyRedactKeys: string[]
  }
  theme: { accent: string; mode: "auto" | "light" | "dark" }
  metadata: Record<string, string | number | boolean>
  fields: { relatedIssue: boolean }
}

/**
 * Normalize a ReproConfigInput to a fully-defaulted ReproConfig.
 *
 * Returns `null` when `projectKey` or `intakeUrl` are empty — this is the
 * silent-disable path that lets hosts turn the SDK off by simply leaving
 * their env vars unset (e.g. `projectKey: process.env.EXPO_PUBLIC_KEY ?? ""`).
 *
 * Throws only when a non-empty value is malformed (typo protection).
 */
export function normalizeConfig(input: ReproConfigInput): ReproConfig | null {
  if (!input.projectKey || !input.intakeUrl) {
    return null
  }
  if (!PROJECT_KEY_PATTERN.test(input.projectKey)) {
    throw new Error(`Repro: invalid projectKey shape`)
  }
  if (!/^https?:\/\//.test(input.intakeUrl)) {
    throw new Error(`Repro: invalid intakeUrl — must be http(s)`)
  }
  return {
    projectKey: input.projectKey,
    intakeUrl: input.intakeUrl.replace(/\/$/, ""),
    reporter: input.reporter ?? null,
    collectors: {
      console: input.collectors?.console ?? true,
      network: {
        enabled: input.collectors?.network?.enabled ?? true,
        captureBodies: input.collectors?.network?.captureBodies ?? false,
      },
      breadcrumbs: input.collectors?.breadcrumbs ?? true,
      systemInfo: input.collectors?.systemInfo ?? true,
    },
    queue: {
      maxReports: input.queue?.maxReports ?? 5,
      maxBytes: input.queue?.maxBytes ?? DEFAULT_QUEUE_MAX_BYTES,
      backoffMs: input.queue?.backoffMs ?? [1000, 5000, 30000, 120000],
      maxAttempts: input.queue?.maxAttempts ?? 10,
      submitTimeoutMs: input.queue?.submitTimeoutMs ?? DEFAULT_SUBMIT_TIMEOUT_MS,
    },
    redact: {
      headerDenylist: input.redact?.headerDenylist ?? DEFAULT_HEADER_DENYLIST,
      bodyRedactKeys: input.redact?.bodyRedactKeys ?? DEFAULT_BODY_REDACT_KEYS,
    },
    theme: {
      accent: input.theme?.accent ?? "#6366f1",
      mode: input.theme?.mode ?? "auto",
    },
    metadata: input.metadata ?? {},
    fields: { relatedIssue: input.fields?.relatedIssue ?? false },
  }
}
