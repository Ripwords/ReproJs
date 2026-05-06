import { z } from "zod"
import { eq } from "drizzle-orm"
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
