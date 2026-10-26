// apps/dashboard/server/lib/github-attach.ts
//
// Attach a report to an issue that already exists in the project's configured
// repository. Shared by the REST endpoint
// (POST /api/projects/:id/reports/:reportId/github-link) and the MCP tool
// `repro_link_github_issue`, so both verify the issue through the App
// installation before `linkReportToGithubIssue` marks the report "attached".
import { and, eq } from "drizzle-orm"
import { createError } from "h3"
import type { GithubIssueSummaryDTO } from "@reprojs/shared"
import type { IssueSummary } from "@reprojs/integrations-github"
import { db } from "../db"
import { githubIntegrations, reports } from "../db/schema"
import type { GithubIntegration } from "../db/schema"
import { getGithubClient } from "./github"
import { linkReportToGithubIssue, linkReportToGithubIssueSideEffects } from "./github-link"

/** Integration row that is connected and has a repository picked. */
export type ConnectedRepo = GithubIntegration & { repoOwner: string; repoName: string }

/**
 * Load the project's GitHub integration and require it to be usable for
 * issue reads. Mirrors the guard in github-sync.post.ts so a stale client or
 * a direct API call cannot reach GitHub through a disconnected installation.
 */
export async function requireConnectedRepo(projectId: string): Promise<ConnectedRepo> {
  const [integration] = await db
    .select()
    .from(githubIntegrations)
    .where(eq(githubIntegrations.projectId, projectId))
    .limit(1)
  if (!integration) {
    throw createError({
      statusCode: 409,
      statusMessage: "GitHub integration not installed for this project",
    })
  }
  if (integration.status !== "connected") {
    throw createError({
      statusCode: 409,
      statusMessage: "GitHub integration is disconnected — reconnect to use GitHub issues",
    })
  }
  if (!integration.repoOwner || !integration.repoName) {
    throw createError({
      statusCode: 409,
      statusMessage: "GitHub integration has no repository configured",
    })
  }
  return integration as ConnectedRepo
}

export function toIssueSummaryDTO(issue: IssueSummary): GithubIssueSummaryDTO {
  return {
    number: issue.number,
    title: issue.title,
    state: issue.state,
    url: issue.url,
    labels: issue.labels,
    updatedAt: issue.updatedAt,
  }
}

/**
 * Fetch one issue from the project's repo. Throws h3 404 "Issue not found"
 * when the number does not exist or names a pull request.
 */
export async function loadGithubIssue(
  integration: ConnectedRepo,
  issueNumber: number,
): Promise<IssueSummary> {
  const client = await getGithubClient(integration.installationId)
  const issue = await client.getIssueSummary(
    integration.repoOwner,
    integration.repoName,
    issueNumber,
  )
  if (!issue) throw createError({ statusCode: 404, statusMessage: "Issue not found" })
  return issue
}

export interface AttachArgs {
  projectId: string
  reportId: string
  actorId: string
  actorClientId: string | null
  issueNumber: number
}

export interface AttachResult {
  issueNumber: number
  issueUrl: string
  alreadyLinked: boolean
}

/**
 * Verify the issue, link the report as "attached" and enqueue the reconcile
 * that posts the report body as a comment. Throws via h3 createError:
 *   - 404 if the report is not in the project, or the issue does not exist
 *   - 409 if the integration is missing / disconnected / has no repo, or the
 *     report is already linked to a different issue
 */
export async function attachReportToGithubIssue(args: AttachArgs): Promise<AttachResult> {
  const [existing] = await db
    .select({ id: reports.id })
    .from(reports)
    .where(and(eq(reports.id, args.reportId), eq(reports.projectId, args.projectId)))
    .limit(1)
  if (!existing) throw createError({ statusCode: 404, statusMessage: "Report not found" })

  const integration = await requireConnectedRepo(args.projectId)
  const issue = await loadGithubIssue(integration, args.issueNumber)

  const result = await db.transaction(async (tx) =>
    linkReportToGithubIssue(tx, {
      projectId: args.projectId,
      reportId: args.reportId,
      actorId: args.actorId,
      actorClientId: args.actorClientId,
      repoOwner: integration.repoOwner,
      repoName: integration.repoName,
      issueNumber: issue.number,
      issueNodeId: issue.nodeId,
      issueTitle: issue.title,
    }),
  )
  if (!result.alreadyLinked) {
    await linkReportToGithubIssueSideEffects({
      reportId: args.reportId,
      projectId: args.projectId,
    })
  }
  return { ...result, issueUrl: issue.url }
}
