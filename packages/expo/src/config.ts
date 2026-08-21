import type { ReporterIdentity } from "@reprojs/shared"

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
  }
  redact?: {
    headerDenylist?: string[]
    bodyRedactKeys?: string[]
  }
  theme?: { accent?: string; mode?: "auto" | "light" | "dark" }
  metadata?: Record<string, string | number | boolean>
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
  }
  redact: {
    headerDenylist: string[]
    bodyRedactKeys: string[]
  }
  theme: { accent: string; mode: "auto" | "light" | "dark" }
  metadata: Record<string, string | number | boolean>
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
      maxBytes: input.queue?.maxBytes ?? 10 * 1024 * 1024,
      backoffMs: input.queue?.backoffMs ?? [1000, 5000, 30000, 120000],
      maxAttempts: input.queue?.maxAttempts ?? 10,
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
  }
}
