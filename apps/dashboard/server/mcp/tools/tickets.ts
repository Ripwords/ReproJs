import { z } from "zod"
import { and, desc, eq, inArray, lt, or, sql } from "drizzle-orm"
import { encodeCursor, decodeCursor } from "../cursor"
import { gunzipSync } from "node:zlib"
import { db } from "../../db"
import { reports, reportAttachments } from "../../db/schema"
import { requireProjectRoleByUser } from "../../lib/permissions"
import { mcpError } from "../errors"
import { buildReplayTranscript, type RrwebEvent } from "../replay-transcript"
import { getStorage } from "../../lib/storage"
import type { McpRequestContext } from "../context"
import type { ReportContext as SharedReportContext } from "@reprojs/shared"

export const getTicketTool = {
  name: "repro_get_ticket",
  config: {
    description:
      "Fetch a single Repro ticket (a.k.a. report) with full context: title, description, status, priority, tags, GitHub link state, page context, system info, console + network logs, and an inline replay transcript when one was captured.",
    inputSchema: z.object({
      ticketId: z.string().uuid().describe("The ticket id (UUID)."),
    }),
  },
  handler: async (input: { ticketId: string }, ctx: McpRequestContext) => {
    const [report] = await db.select().from(reports).where(eq(reports.id, input.ticketId)).limit(1)
    if (!report) throw mcpError("NOT_FOUND", `ticket ${input.ticketId} not found`)
    await requireProjectRoleByUser(ctx.userId, report.projectId, "viewer")

    const attachments = await db
      .select({
        id: reportAttachments.id,
        kind: reportAttachments.kind,
        storageKey: reportAttachments.storageKey,
        contentType: reportAttachments.contentType,
        size: reportAttachments.sizeBytes,
      })
      .from(reportAttachments)
      .where(eq(reportAttachments.reportId, report.id))

    const storage = await getStorage()

    // Replay: parse from gzip-compressed JSON stored in the "replay" attachment.
    let replay: { durationMs: number; eventCount: number; transcript: string } | null = null
    const replayAttachment = attachments.find((a) => a.kind === "replay")
    if (replayAttachment) {
      try {
        const { bytes } = await storage.get(replayAttachment.storageKey)
        // Replay is always stored as application/gzip (see intake handler).
        const decompressed = gunzipSync(bytes)
        const events = JSON.parse(decompressed.toString("utf-8")) as RrwebEvent[]
        const t = buildReplayTranscript(events, { verbosity: "summary" })
        replay = {
          durationMs: t.durationMs,
          eventCount: t.eventCount,
          transcript: t.transcript,
        }
      } catch {
        // Graceful failure: missing storage object or corrupt gzip → replay: null.
        replay = null
      }
    }

    // Console + network logs: stored as a separate "logs" attachment (JSON).
    let consoleLog: unknown[] = []
    let networkLog: unknown[] = []
    let breadcrumbs: unknown[] = []
    const logsAttachment = attachments.find((a) => a.kind === "logs")
    if (logsAttachment) {
      try {
        const { bytes } = await storage.get(logsAttachment.storageKey)
        const parsed = JSON.parse(Buffer.from(bytes).toString("utf-8")) as {
          console?: unknown[]
          network?: unknown[]
          breadcrumbs?: unknown[]
        }
        consoleLog = parsed.console ?? []
        networkLog = parsed.network ?? []
        breadcrumbs = parsed.breadcrumbs ?? []
      } catch {
        // Graceful failure: missing or corrupt logs → empty arrays.
      }
    }

    // The context JSONB is a ReportContext from @reprojs/shared:
    // { source, pageUrl, userAgent, viewport, timestamp, reporter, metadata, systemInfo, cookies }
    const context = (report.context ?? {}) as SharedReportContext

    const payload = {
      id: report.id,
      projectId: report.projectId,
      title: report.title,
      description: report.description ?? "",
      status: report.status,
      priority: report.priority,
      tags: report.tags,
      createdAt: report.createdAt.toISOString(),
      updatedAt: report.updatedAt.toISOString(),
      github: report.githubIssueNumber
        ? {
            issueNumber: report.githubIssueNumber,
            issueUrl: report.githubIssueUrl ?? null,
          }
        : null,
      pageContext: {
        url: context.pageUrl ?? null,
        referrer: context.systemInfo?.referrer ?? null,
        userAgent: context.userAgent ?? null,
        viewport: context.viewport ?? null,
        timestamp: context.timestamp ?? null,
      },
      systemInfo: context.systemInfo ?? null,
      reporter: context.reporter ?? null,
      consoleLog,
      networkLog,
      breadcrumbs,
      attachments: attachments.map((a) => ({
        id: a.id,
        kind: a.kind,
        contentType: a.contentType,
        size: a.size,
      })),
      replay,
      customMetadata: context.metadata ?? {},
    }

    return {
      content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
    }
  },
}

export const listTicketsTool = {
  name: "repro_list_tickets",
  config: {
    description:
      "List Repro tickets (reports) in a project, newest first. Supports filtering by status, priority, tags, free-text search, and cursor pagination. Returns up to 50 items per page.",
    inputSchema: z.object({
      projectId: z.string().uuid(),
      status: z
        .array(z.enum(["open", "in_progress", "resolved", "closed"]))
        .optional()
        .describe("Filter to these statuses (default: any)."),
      priority: z
        .array(z.enum(["low", "normal", "high", "urgent"]))
        .optional()
        .describe("Filter to these priorities (default: any)."),
      tag: z
        .array(z.string())
        .optional()
        .describe("Filter to tickets containing ALL of these tags."),
      query: z
        .string()
        .optional()
        .describe("Case-insensitive substring match on title/description."),
      cursor: z.string().optional(),
      limit: z.number().int().min(1).max(50).optional(),
    }),
  },
  handler: async (
    input: {
      projectId: string
      status?: string[]
      priority?: string[]
      tag?: string[]
      query?: string
      cursor?: string
      limit?: number
    },
    ctx: McpRequestContext,
  ) => {
    await requireProjectRoleByUser(ctx.userId, input.projectId, "viewer")
    const limit = input.limit ?? 25
    const decodedCursor = input.cursor ? decodeCursor(input.cursor) : null

    const conditions = [eq(reports.projectId, input.projectId)]
    if (input.status?.length) {
      conditions.push(
        inArray(reports.status, input.status as ("open" | "in_progress" | "resolved" | "closed")[]),
      )
    }
    if (input.priority?.length) {
      conditions.push(
        inArray(reports.priority, input.priority as ("low" | "normal" | "high" | "urgent")[]),
      )
    }
    if (input.tag?.length) {
      // tags @> ARRAY[$tags] — Postgres array-contains.
      conditions.push(sql`${reports.tags} @> ${input.tag}::text[]`)
    }
    if (input.query) {
      const needle = `%${input.query.toLowerCase()}%`
      conditions.push(
        sql`(lower(${reports.title}) LIKE ${needle} OR lower(coalesce(${reports.description}, '')) LIKE ${needle})`,
      )
    }
    if (decodedCursor) {
      // Keyset pagination: rows strictly after the cursor in (createdAt DESC, id DESC).
      conditions.push(
        or(
          lt(reports.createdAt, decodedCursor.createdAt),
          and(eq(reports.createdAt, decodedCursor.createdAt), lt(reports.id, decodedCursor.id)),
        )!,
      )
    }

    const rows = await db
      .select({
        id: reports.id,
        title: reports.title,
        status: reports.status,
        priority: reports.priority,
        tags: reports.tags,
        githubIssueNumber: reports.githubIssueNumber,
        githubIssueUrl: reports.githubIssueUrl,
        createdAt: reports.createdAt,
        updatedAt: reports.updatedAt,
      })
      .from(reports)
      .where(and(...conditions))
      .orderBy(desc(reports.createdAt), desc(reports.id))
      .limit(limit + 1)

    const hasMore = rows.length > limit
    const page = rows.slice(0, limit)
    const nextCursor =
      hasMore && page.length > 0
        ? encodeCursor({
            createdAt: page[page.length - 1]!.createdAt,
            id: page[page.length - 1]!.id,
          })
        : null

    const items = page.map((r) => ({
      id: r.id,
      title: r.title,
      status: r.status,
      priority: r.priority,
      tags: r.tags,
      github: r.githubIssueNumber
        ? { issueNumber: r.githubIssueNumber, issueUrl: r.githubIssueUrl ?? null }
        : null,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }))
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ items, nextCursor }, null, 2) }],
    }
  },
}
