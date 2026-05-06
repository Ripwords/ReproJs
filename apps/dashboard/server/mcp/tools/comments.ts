import { z } from "zod"
import { and, desc, eq, isNull, lt, or } from "drizzle-orm"
import { db } from "../../db"
import { reports, reportComments } from "../../db/schema"
import { requireProjectRoleByUser } from "../../lib/permissions"
import { mcpError } from "../errors"
import { decodeCursor, encodeCursor } from "../cursor"
import type { McpRequestContext } from "../context"

export const listTicketCommentsTool = {
  name: "repro_list_ticket_comments",
  config: {
    description:
      "List comments on a Repro ticket, newest first. Returns up to 50 per page. Comments may originate from the dashboard or be mirrored from GitHub (see the `source` field).",
    inputSchema: z.object({
      ticketId: z.string().uuid(),
      cursor: z.string().optional(),
      limit: z.number().int().min(1).max(50).optional(),
    }),
  },
  handler: async (
    input: { ticketId: string; cursor?: string; limit?: number },
    ctx: McpRequestContext,
  ) => {
    const [report] = await db
      .select({ projectId: reports.projectId })
      .from(reports)
      .where(eq(reports.id, input.ticketId))
      .limit(1)
    if (!report) throw mcpError("NOT_FOUND", `ticket ${input.ticketId} not found`)
    await requireProjectRoleByUser(ctx.userId, report.projectId, "viewer")

    const limit = input.limit ?? 25
    const decodedCursor = input.cursor ? decodeCursor(input.cursor) : null

    const conditions = [
      eq(reportComments.reportId, input.ticketId),
      isNull(reportComments.deletedAt),
    ]
    if (decodedCursor) {
      conditions.push(
        or(
          lt(reportComments.createdAt, decodedCursor.createdAt),
          and(
            eq(reportComments.createdAt, decodedCursor.createdAt),
            lt(reportComments.id, decodedCursor.id),
          ),
        )!,
      )
    }

    const rows = await db
      .select({
        id: reportComments.id,
        body: reportComments.body,
        userId: reportComments.userId,
        githubLogin: reportComments.githubLogin,
        source: reportComments.source,
        createdAt: reportComments.createdAt,
        updatedAt: reportComments.updatedAt,
      })
      .from(reportComments)
      .where(and(...conditions))
      .orderBy(desc(reportComments.createdAt), desc(reportComments.id))
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

    const items = page.map((c) => ({
      id: c.id,
      body: c.body,
      source: c.source,
      authorUserId: c.userId,
      authorGithubLogin: c.githubLogin,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
    }))
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ items, nextCursor }, null, 2) }],
    }
  },
}
