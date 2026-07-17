import { z } from "zod"

export const ReporterIdentity = z.object({
  userId: z.string().optional(),
  email: z.email().optional(),
  name: z.string().max(200).optional(),
})
export type ReporterIdentity = z.infer<typeof ReporterIdentity>

export const ReportSource = z.enum(["web", "expo"])
export type ReportSource = z.infer<typeof ReportSource>

export const DevicePlatform = z.enum(["ios", "android"])
export type DevicePlatform = z.infer<typeof DevicePlatform>

export const SystemInfo = z.object({
  userAgent: z.string(),
  platform: z.string(),
  devicePlatform: DevicePlatform.optional(),
  appVersion: z.string().optional(),
  appBuild: z.string().optional(),
  deviceModel: z.string().optional(),
  osVersion: z.string().optional(),
  language: z.string(),
  timezone: z.string(),
  timezoneOffset: z.number(),
  viewport: z.object({ w: z.number().int().positive(), h: z.number().int().positive() }),
  screen: z.object({ w: z.number().int().positive(), h: z.number().int().positive() }),
  dpr: z.number().positive(),
  online: z.boolean(),
  connection: z
    .object({
      effectiveType: z.string().optional(),
      rtt: z.number().optional(),
      downlink: z.number().optional(),
    })
    .optional(),
  pageUrl: z.string().max(2048),
  referrer: z.string().optional(),
  timestamp: z.string(),
})
export type SystemInfo = z.infer<typeof SystemInfo>

export const CookieEntry = z.object({
  name: z.string(),
  value: z.string(),
})
export type CookieEntry = z.infer<typeof CookieEntry>

export const ConsoleEntry = z.object({
  level: z.enum(["log", "info", "warn", "error", "debug"]),
  ts: z.number().int(),
  args: z.array(z.string()),
  stack: z.string().optional(),
})
export type ConsoleEntry = z.infer<typeof ConsoleEntry>

export const NetworkEntry = z.object({
  id: z.string(),
  ts: z.number().int(),
  method: z.string(),
  url: z.string(),
  status: z.number().int().nullable(),
  durationMs: z.number().nonnegative().nullable(),
  size: z.number().int().nullable(),
  initiator: z.enum(["fetch", "xhr"]),
  requestHeaders: z.record(z.string(), z.string()).optional(),
  responseHeaders: z.record(z.string(), z.string()).optional(),
  requestBody: z.string().optional(),
  responseBody: z.string().optional(),
  error: z.string().optional(),
})
export type NetworkEntry = z.infer<typeof NetworkEntry>

export const Breadcrumb = z.object({
  ts: z.number().int(),
  event: z.string().max(200),
  level: z.enum(["debug", "info", "warn", "error"]).default("info"),
  data: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
})
export type Breadcrumb = z.infer<typeof Breadcrumb>

export const LogsAttachment = z.object({
  version: z.literal(1),
  console: z.array(ConsoleEntry),
  network: z.array(NetworkEntry),
  breadcrumbs: z.array(Breadcrumb),
  config: z.object({
    consoleMax: z.number(),
    networkMax: z.number(),
    breadcrumbsMax: z.number(),
    capturesBodies: z.boolean(),
    capturesAllHeaders: z.boolean(),
  }),
})
export type LogsAttachment = z.infer<typeof LogsAttachment>

export const ReportContext = z.object({
  source: ReportSource.default("web"),
  pageUrl: z.string().max(2048),
  userAgent: z.string().max(1000),
  viewport: z.object({ w: z.number().int().positive(), h: z.number().int().positive() }),
  timestamp: z.string(),
  reporter: ReporterIdentity.optional(),
  metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  systemInfo: SystemInfo.optional(),
  cookies: z.array(CookieEntry).optional(),
})
export type ReportContext = z.infer<typeof ReportContext>

export const ReportStatus = z.enum(["open", "in_progress", "resolved", "closed"])
export type ReportStatus = z.infer<typeof ReportStatus>

export const ReportPriority = z.enum(["low", "normal", "high", "urgent"])
export type ReportPriority = z.infer<typeof ReportPriority>

// `ReportActorDTO` describes the *actor* of an event — the dashboard user who
// performed the triage action. Assignees are a separate concept (they live
// on GitHub); see `ReportAssigneeDTO` below.
export const ReportActorDTO = z.object({
  id: z.string().nullable(),
  name: z.string().nullable(),
  email: z.string().nullable(),
  githubLogin: z.string().nullable(),
  githubAvatarUrl: z.string().nullable(),
})
export type ReportActorDTO = z.infer<typeof ReportActorDTO>

// Assignees are mirrored from GitHub — there is no dashboard-user assignee.
// Only projects with a connected GitHub integration and a linked issue can
// have assignees; everyone else gets an empty array.
export const ReportAssigneeDTO = z.object({
  login: z.string(),
  avatarUrl: z.string().nullable(),
})
export type ReportAssigneeDTO = z.infer<typeof ReportAssigneeDTO>

export const ReportEventKind = z.enum([
  "status_changed",
  "assignee_changed",
  "priority_changed",
  "tag_added",
  "tag_removed",
  "github_unlinked",
  "assignee_added",
  "assignee_removed",
  "milestone_changed",
  "comment_added",
  "comment_edited",
  "comment_deleted",
  "github_labels_updated",
])
export type ReportEventKind = z.infer<typeof ReportEventKind>

export const ReportEventDTO = z.object({
  id: z.uuid(),
  createdAt: z.string(),
  actor: ReportActorDTO.nullable(),
  kind: ReportEventKind,
  payload: z.record(z.string(), z.unknown()),
})
export type ReportEventDTO = z.infer<typeof ReportEventDTO>

// `assignees` / `milestone` only apply to reports that are linked to a GitHub
// issue (project has a connected integration + `githubIssueNumber !== null`).
// The server returns 409 if those fields are present against a report that
// can't round-trip them to GitHub.
export const TriagePatchInput = z
  .object({
    status: ReportStatus.optional(),
    priority: ReportPriority.optional(),
    tags: z.array(z.string().min(1).max(40)).max(20).optional(),
    assignees: z.array(z.string().min(1).max(39)).max(10).optional(),
    milestone: z
      .union([z.object({ number: z.number().int(), title: z.string() }), z.null()])
      .optional(),
  })
  .refine(
    (v) =>
      v.status !== undefined ||
      v.priority !== undefined ||
      v.tags !== undefined ||
      v.assignees !== undefined ||
      v.milestone !== undefined,
    { message: "At least one field must be present" },
  )
export type TriagePatchInput = z.infer<typeof TriagePatchInput>

export const CreateCommentBody = z.object({
  body: z.string().min(1).max(65_536),
})
export type CreateCommentBody = z.infer<typeof CreateCommentBody>

export const BulkUpdateInput = z
  .object({
    reportIds: z.array(z.uuid()).min(1).max(100),
    status: ReportStatus.optional(),
    assignees: z.array(z.string().min(1).max(39)).max(10).optional(),
  })
  .refine((v) => v.status !== undefined || v.assignees !== undefined, {
    message: "At least one of status or assignees must be present",
  })
export type BulkUpdateInput = z.infer<typeof BulkUpdateInput>

export const ReportIntakeInput = z.object({
  projectKey: z.string().regex(/^rp_pk_[A-Za-z0-9]{24}$/),
  title: z.string().min(1).max(120),
  description: z.string().max(10_000).optional(),
  context: ReportContext,
  metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  // Anti-abuse: honeypot (hidden field that real users never fill) and
  // dwell time in ms between widget open and submit.
  _hp: z.string().max(200).optional(),
  _dwellMs: z.number().int().min(0).max(86_400_000).optional(),
})
export type ReportIntakeInput = z.infer<typeof ReportIntakeInput>

export const AttachmentKind = z.enum([
  "screenshot",
  "annotated-screenshot",
  "replay",
  "logs",
  "user-file",
  "media",
])
export type AttachmentKind = z.infer<typeof AttachmentKind>

/** Sidecar metadata for gallery media parts (`media[N]` + `mediaMeta`). */
export const MediaMetaEntry = z.object({
  kind: z.enum(["image", "video"]),
  mime: z.string().min(1).max(255),
  durationMs: z.number().int().nonnegative().optional(),
  trim: z
    .object({ startMs: z.number().int().nonnegative(), endMs: z.number().int().positive() })
    .refine((t) => t.endMs > t.startMs, "endMs must be after startMs")
    .optional(),
})
export type MediaMetaEntry = z.infer<typeof MediaMetaEntry>
export const MediaMetaInput = z.array(MediaMetaEntry).max(3)
export type MediaMetaInput = z.infer<typeof MediaMetaInput>

export const AttachmentDTO = z.object({
  id: z.uuid(),
  kind: AttachmentKind,
  url: z.string(),
  contentType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  filename: z.string().nullable(),
  // Virus-scan provenance for user-file attachments. NULL on legacy rows or
  // when scanning was disabled at intake time.
  scannedAt: z.string().nullable(),
  scanStatus: z.string().nullable(),
  scanEngine: z.string().nullable(),
  scanDurationMs: z.number().int().nullable(),
  durationMs: z.number().int().nullable(),
  trimStartMs: z.number().int().nullable(),
  trimEndMs: z.number().int().nullable(),
})
export type AttachmentDTO = z.infer<typeof AttachmentDTO>

export const ReportSummaryDTO = z.object({
  id: z.uuid(),
  title: z.string(),
  description: z.string().nullable(),
  context: ReportContext,
  source: ReportSource,
  devicePlatform: DevicePlatform.nullable(),
  reporterEmail: z.string().nullable(),
  pageUrl: z.string(),
  thumbnailUrl: z.string().nullable(),
  hasReplay: z.boolean(),
  receivedAt: z.string(),
  updatedAt: z.string(),
  status: ReportStatus,
  priority: ReportPriority,
  tags: z.array(z.string()),
  githubIssueNumber: z.number().int().nullable(),
  githubIssueUrl: z.string().nullable(),
  assignees: z.array(ReportAssigneeDTO).default([]),
  milestoneNumber: z.number().int().nullable(),
  milestoneTitle: z.string().nullable(),
})
export type ReportSummaryDTO = z.infer<typeof ReportSummaryDTO>

export const ReportDetailDTO = ReportSummaryDTO.extend({
  attachments: z.array(AttachmentDTO),
})
export type ReportDetailDTO = z.infer<typeof ReportDetailDTO>

export const IntakeResponse = z.object({
  id: z.uuid(),
  /** True when the server silently dropped the replay part (per-project or per-deployment disable). */
  replayStored: z.boolean().optional(),
  replayDisabled: z.boolean().optional(),
})
export type IntakeResponse = z.infer<typeof IntakeResponse>
