// apps/dashboard/server/mcp/tools/writes.ts
import { z } from "zod"
import { eq } from "drizzle-orm"
import { TriagePatchInput } from "@reprojs/shared"
import { db } from "../../db"
import { reports } from "../../db/schema"
import { requireProjectRoleByUser } from "../../lib/permissions"
import { mcpError } from "../errors"
import { applyTicketTriagePatch, applyTicketTriagePatchSideEffects } from "../../lib/triage"
import { addReportComment, addReportCommentSideEffects } from "../../lib/comments-service"
import {
  linkReportToGithubIssue,
  linkReportToGithubIssueSideEffects,
  unlinkReportFromGithubIssue,
} from "../../lib/github-link"
import type { McpRequestContext } from "../context"

async function loadReportProjectId(ticketId: string): Promise<string> {
  const [report] = await db
    .select({ projectId: reports.projectId })
    .from(reports)
    .where(eq(reports.id, ticketId))
    .limit(1)
  if (!report) throw mcpError("NOT_FOUND", `ticket ${ticketId} not found`)
  return report.projectId
}

// -----------------------------------------------------------------------
// repro_update_ticket
// -----------------------------------------------------------------------

export const updateTicketTool = {
  name: "repro_update_ticket",
  config: {
    description:
      "Update a ticket's triage fields. Pass any subset of: status, priority, tags (full replacement), assignees (full replacement of GitHub logins; requires linked GitHub issue), milestone (requires linked GitHub issue). At least one field must be present. Permission: manager+.",
    inputSchema: z.object({
      ticketId: z.string().uuid(),
      status: z.enum(["open", "in_progress", "resolved", "closed"]).optional(),
      priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
      tags: z.array(z.string().min(1).max(40)).max(20).optional(),
      assignees: z
        .array(z.string().min(1).max(39))
        .max(10)
        .optional()
        .describe("Full set of GitHub logins to assign. Empty array clears."),
      milestone: z
        .union([z.object({ number: z.number().int(), title: z.string() }), z.null()])
        .optional()
        .describe("Pass null to clear. Requires linked GitHub issue."),
    }),
  },
  handler: async (
    input: {
      ticketId: string
      status?: "open" | "in_progress" | "resolved" | "closed"
      priority?: "low" | "normal" | "high" | "urgent"
      tags?: string[]
      assignees?: string[]
      milestone?: { number: number; title: string } | null
    },
    ctx: McpRequestContext,
  ) => {
    const projectId = await loadReportProjectId(input.ticketId)
    await requireProjectRoleByUser(ctx.userId, projectId, "manager")

    // Re-validate the patch body via the shared schema for parity with the
    // dashboard endpoint (also enforces "at least one field present").
    const body = TriagePatchInput.parse({
      status: input.status,
      priority: input.priority,
      tags: input.tags,
      assignees: input.assignees,
      milestone: input.milestone,
    })

    const result = await db.transaction(async (tx) =>
      applyTicketTriagePatch(tx, {
        projectId,
        reportId: input.ticketId,
        actorId: ctx.userId,
        actorClientId: ctx.clientId,
        body,
      }),
    )
    await applyTicketTriagePatchSideEffects(input.ticketId, projectId, result)

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ ok: result.ok, updated: result.updated }, null, 2),
        },
      ],
    }
  },
}

// -----------------------------------------------------------------------
// repro_add_comment
// -----------------------------------------------------------------------

export const addCommentTool = {
  name: "repro_add_comment",
  config: {
    description:
      "Post a comment on a ticket. The comment is sourced as 'dashboard' (mirrored to GitHub if the ticket is linked). Markdown body, 1–65536 chars. Permission: manager+.",
    inputSchema: z.object({
      ticketId: z.string().uuid(),
      body: z.string().min(1).max(65_536),
    }),
  },
  handler: async (input: { ticketId: string; body: string }, ctx: McpRequestContext) => {
    const projectId = await loadReportProjectId(input.ticketId)
    await requireProjectRoleByUser(ctx.userId, projectId, "manager")

    const result = await db.transaction(async (tx) =>
      addReportComment(tx, {
        projectId,
        reportId: input.ticketId,
        actorId: ctx.userId,
        actorClientId: ctx.clientId,
        body: input.body,
      }),
    )
    await addReportCommentSideEffects({
      projectId,
      reportId: input.ticketId,
      commentId: result.comment.id,
      githubIssueNumber: result.githubIssueNumber,
    })

    return {
      content: [
        { type: "text" as const, text: JSON.stringify({ comment: result.comment }, null, 2) },
      ],
    }
  },
}

// -----------------------------------------------------------------------
// repro_link_github_issue
// -----------------------------------------------------------------------

export const linkGithubIssueTool = {
  name: "repro_link_github_issue",
  config: {
    description:
      "Link a Repro ticket to an existing GitHub issue. The link is asynchronous — the next sync tick pulls the issue's labels/assignees/status from GitHub. The project must have a connected GitHub integration. Permission: manager+.",
    inputSchema: z.object({
      ticketId: z.string().uuid(),
      repoOwner: z.string().min(1).max(80),
      repoName: z.string().min(1).max(120),
      issueNumber: z.number().int().min(1),
    }),
  },
  handler: async (
    input: {
      ticketId: string
      repoOwner: string
      repoName: string
      issueNumber: number
    },
    ctx: McpRequestContext,
  ) => {
    const projectId = await loadReportProjectId(input.ticketId)
    await requireProjectRoleByUser(ctx.userId, projectId, "manager")

    const result = await db.transaction(async (tx) =>
      linkReportToGithubIssue(tx, {
        projectId,
        reportId: input.ticketId,
        actorId: ctx.userId,
        actorClientId: ctx.clientId,
        repoOwner: input.repoOwner,
        repoName: input.repoName,
        issueNumber: input.issueNumber,
      }),
    )
    if (!result.alreadyLinked) {
      await linkReportToGithubIssueSideEffects({
        reportId: input.ticketId,
        projectId,
      })
    }

    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    }
  },
}

// -----------------------------------------------------------------------
// repro_unlink_github_issue
// -----------------------------------------------------------------------

export const unlinkGithubIssueTool = {
  name: "repro_unlink_github_issue",
  config: {
    description:
      "Unlink a Repro ticket from its GitHub issue. Idempotent — returns { unlinked: false } if the ticket wasn't linked. Permission: manager+.",
    inputSchema: z.object({
      ticketId: z.string().uuid(),
    }),
  },
  handler: async (input: { ticketId: string }, ctx: McpRequestContext) => {
    const projectId = await loadReportProjectId(input.ticketId)
    await requireProjectRoleByUser(ctx.userId, projectId, "manager")

    const result = await db.transaction(async (tx) =>
      unlinkReportFromGithubIssue(tx, {
        projectId,
        reportId: input.ticketId,
        actorId: ctx.userId,
        actorClientId: ctx.clientId,
      }),
    )

    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    }
  },
}
