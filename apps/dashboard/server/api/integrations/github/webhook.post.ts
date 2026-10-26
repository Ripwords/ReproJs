// apps/dashboard/server/api/integrations/github/webhook.post.ts
import { createError, defineEventHandler, getHeader, readRawBody, setResponseStatus } from "h3"
import { and, desc, eq, isNull, ne } from "drizzle-orm"
import { verifyWebhookSignature } from "@reprojs/integrations-github"
import { db } from "../../../db"
import {
  githubIntegrations,
  reportAssignees,
  reportComments,
  reportEvents,
  reports,
} from "../../../db/schema"
import { getWebhookSecret } from "../../../lib/github"
import { invalidateInstallationRepos } from "../../../lib/github-cache"
import { publishReportStream } from "../../../lib/report-events-bus"
import { githubCache } from "../../../lib/github-cache"
import { parseGithubLabels } from "../../../lib/github-helpers"
import {
  checkBodySize,
  MAX_WEBHOOK_BODY_BYTES,
  forgetDelivery,
  recordDelivery,
  isKnownInstallation,
} from "../../../lib/github-webhook-auth"
import {
  signCommentDelete,
  signCommentUpsert,
  signLabels,
  signState,
  signAssignees,
  signMilestone,
  signTitle,
} from "../../../lib/github-diff"
import { consumeWriteLock } from "../../../lib/github-write-locks"
import { stripBotFooter } from "../../../lib/comment-serializer"
import { env } from "../../../lib/env"
import { resolveGithubUser } from "../../../lib/github-identities"
import { isUniqueViolation } from "../../../lib/pg-errors"

interface IssueAssignee {
  login: string
  id: number
  avatar_url: string
}

interface IssuesPayload {
  action:
    | "opened"
    | "closed"
    | "reopened"
    | "edited"
    | "labeled"
    | "unlabeled"
    | "assigned"
    | "unassigned"
    | "milestoned"
    | "demilestoned"
    | "deleted"
    | string
  issue: {
    number: number
    title: string
    state: "open" | "closed"
    state_reason?: "completed" | "not_planned" | null
    labels: Array<{ name: string }>
    assignees?: IssueAssignee[]
    milestone?: { number: number; title: string } | null
  }
  changes?: {
    title?: { from: string }
    body?: { from: string }
  }
  assignee?: IssueAssignee | null
  repository: { name: string; owner: { login: string } }
  installation?: { id: number }
}

interface InstallationPayload {
  action: "created" | "deleted" | "suspend" | "unsuspend" | string
  installation: { id: number }
}

interface InstallationReposPayload {
  action: "added" | "removed"
  installation: { id: number }
  repositories_removed?: Array<{ name: string; full_name: string }>
}

interface RepoEventPayload {
  action: string
  repository?: { name: string; owner: { login: string } }
  installation?: { id: number }
}

interface IssueCommentPayload {
  action: "created" | "edited" | "deleted" | string
  comment: {
    id: number
    body: string | null
    user: { id: number; login: string; avatar_url: string } | null
  }
  issue: { number: number }
  repository: { name: string; owner: { login: string } }
  installation?: { id: number }
}

/** Find a report linked to an issue in a repo. */
async function findLinkedReport(issueNumber: number, repoOwner: string, repoName: string) {
  const [linked] = await db
    .select({ r: reports, gi: githubIntegrations })
    .from(reports)
    .innerJoin(githubIntegrations, eq(githubIntegrations.projectId, reports.projectId))
    .where(
      and(
        eq(reports.githubIssueNumber, issueNumber),
        eq(githubIntegrations.repoOwner, repoOwner),
        eq(githubIntegrations.repoName, repoName),
      ),
    )
    .limit(1)
  return linked ?? null
}

/** Apply inbound GitHub assignees to report_assignees (full replace). */
async function applyInboundAssignees(
  reportId: string,
  projectId: string,
  assignees: IssueAssignee[],
): Promise<void> {
  // Delete all existing assignees for this report
  await db.delete(reportAssignees).where(eq(reportAssignees.reportId, reportId))

  if (assignees.length === 0) return

  // Insert the inbound set
  await db.insert(reportAssignees).values(
    assignees.map((a) => ({
      reportId,
      githubLogin: a.login,
      githubUserId: String(a.id),
      githubAvatarUrl: a.avatar_url,
    })),
  )

  // Emit events for each new assignee
  const events = assignees.map((a) => ({
    reportId,
    projectId,
    actorId: null as string | null,
    kind: "assignee_added" as const,
    payload: { githubLogin: a.login, source: "github" } as Record<string, unknown>,
  }))
  if (events.length > 0) {
    await db.insert(reportEvents).values(events)
  }
}

export default defineEventHandler(async (event) => {
  const contentLength = Number(getHeader(event, "content-length") ?? NaN)
  if (!checkBodySize(Number.isNaN(contentLength) ? undefined : contentLength)) {
    throw createError({ statusCode: 413, statusMessage: "Payload Too Large" })
  }
  const raw = await readRawBody(event)
  if (!raw || typeof raw !== "string") {
    throw createError({ statusCode: 400, statusMessage: "invalid body" })
  }
  // Fallback guard when Content-Length is missing or understated (chunked).
  if (Buffer.byteLength(raw, "utf8") > MAX_WEBHOOK_BODY_BYTES) {
    throw createError({ statusCode: 413, statusMessage: "Payload Too Large" })
  }
  const sig = getHeader(event, "x-hub-signature-256")
  if (
    !sig ||
    !verifyWebhookSignature({
      secret: await getWebhookSecret(),
      payload: raw,
      signatureHeader: sig,
    })
  ) {
    throw createError({ statusCode: 401, statusMessage: "invalid signature" })
  }

  const deliveryId = getHeader(event, "x-github-delivery")
  if (!deliveryId) {
    throw createError({ statusCode: 400, statusMessage: "Missing X-GitHub-Delivery" })
  }
  if ((await recordDelivery(deliveryId)) === "replay") {
    setResponseStatus(event, 202)
    return { status: "replay" }
  }

  // The delivery id is claimed above so a concurrent duplicate is rejected
  // immediately, but it only stays claimed if processing succeeds. On any
  // throw we release it (see catch at the bottom) so GitHub's redelivery of
  // the same GUID gets a real second attempt instead of `202 replay`.
  try {
    const kind = getHeader(event, "x-github-event")
    const payload: unknown = JSON.parse(raw)

    const installationId = (payload as { installation?: { id?: unknown } })?.installation?.id
    if (typeof installationId === "number" && !(await isKnownInstallation(installationId))) {
      console.warn(
        `[github-webhook] unknown installation id: ${installationId}, delivery=${deliveryId}`,
      )
      setResponseStatus(event, 202)
      return { status: "unknown-installation" }
    }

    if (kind === "installation") {
      const p = payload as InstallationPayload
      if (p.action === "deleted" || p.action === "suspend") {
        await db
          .update(githubIntegrations)
          .set({ status: "disconnected", updatedAt: new Date() })
          .where(eq(githubIntegrations.installationId, p.installation.id))
        invalidateInstallationRepos(p.installation.id)
      } else if (p.action === "unsuspend") {
        // GitHub lifts a suspension without a reinstall, so no OAuth round-trip
        // ever flips the row back. Only rows that still have a repo picked are
        // restored — a `disconnected` row without one needs the picker anyway.
        await db
          .update(githubIntegrations)
          .set({ status: "connected", updatedAt: new Date() })
          .where(
            and(
              eq(githubIntegrations.installationId, p.installation.id),
              eq(githubIntegrations.status, "disconnected"),
              ne(githubIntegrations.repoOwner, ""),
              ne(githubIntegrations.repoName, ""),
            ),
          )
        invalidateInstallationRepos(p.installation.id)
      }
    } else if (kind === "installation_repositories") {
      const p = payload as InstallationReposPayload
      invalidateInstallationRepos(p.installation.id)
      // Invalidate all picker caches for this installation — covers any repo that
      // was added or removed so labels/assignees/milestones are re-fetched.
      githubCache.invalidatePrefix(`${p.installation.id}:`)
      if (p.action === "removed" && p.repositories_removed?.length) {
        const removedNames = new Set(p.repositories_removed.map((r) => r.full_name))
        const rows = await db
          .select()
          .from(githubIntegrations)
          .where(eq(githubIntegrations.installationId, p.installation.id))
        await Promise.all(
          rows
            .filter((row) => removedNames.has(`${row.repoOwner}/${row.repoName}`))
            .map((row) =>
              db
                .update(githubIntegrations)
                .set({ status: "disconnected", updatedAt: new Date() })
                .where(eq(githubIntegrations.projectId, row.projectId)),
            ),
        )
      }
    } else if (kind === "label") {
      const p = payload as RepoEventPayload
      if (p.repository && p.installation) {
        githubCache.invalidate(
          `${p.installation.id}:${p.repository.owner.login}/${p.repository.name}:labels`,
        )
      }
    } else if (kind === "milestone") {
      const p = payload as RepoEventPayload
      if (p.repository && p.installation) {
        githubCache.invalidatePrefix(
          `${p.installation.id}:${p.repository.owner.login}/${p.repository.name}:milestones`,
        )
      }
    } else if (kind === "member") {
      const p = payload as RepoEventPayload
      if (p.repository && p.installation) {
        githubCache.invalidate(
          `${p.installation.id}:${p.repository.owner.login}/${p.repository.name}:assignees`,
        )
      }
    } else if (kind === "issues") {
      const p = payload as IssuesPayload

      if (p.action === "closed" || p.action === "reopened") {
        const desired =
          p.action === "reopened"
            ? "open"
            : p.issue.state_reason === "not_planned"
              ? "closed"
              : "resolved"
        const desiredGhState: "open" | "closed" = p.action === "reopened" ? "open" : "closed"
        const stateReason =
          p.action === "reopened"
            ? "reopened"
            : p.issue.state_reason === "not_planned"
              ? "not_planned"
              : "completed"

        const linked = await findLinkedReport(
          p.issue.number,
          p.repository.owner.login,
          p.repository.name,
        )
        if (!linked) {
          setResponseStatus(event, 202)
          return { ok: true }
        }

        // Write-lock echo check
        const sig2 = signState(desiredGhState, stateReason)
        const isEcho = await consumeWriteLock(db, {
          reportId: linked.r.id,
          kind: "state",
          signature: sig2,
        })
        if (isEcho) {
          setResponseStatus(event, 202)
          return { ok: true, echo: true }
        }

        if (linked.r.status !== desired) {
          await db.transaction(async (tx) => {
            await tx
              .update(reports)
              .set({ status: desired, updatedAt: new Date() })
              .where(eq(reports.id, linked.r.id))
            await tx.insert(reportEvents).values({
              reportId: linked.r.id,
              projectId: linked.r.projectId,
              actorId: null,
              kind: "status_changed",
              payload: { from: linked.r.status, to: desired, source: "github" },
            })
          })
          publishReportStream(linked.r.id, { kind: "triage", payload: { source: "github" } })
        }
      } else if (p.action === "labeled" || p.action === "unlabeled") {
        const issueLabels = p.issue.labels?.map((l) => l.name) ?? []
        const linked = await findLinkedReport(
          p.issue.number,
          p.repository.owner.login,
          p.repository.name,
        )

        if (!linked) {
          setResponseStatus(event, 202)
          return { ok: true }
        }

        // Write-lock echo check — signature is over the full post-event label set
        const labelSig = signLabels(issueLabels)
        const isEcho = await consumeWriteLock(db, {
          reportId: linked.r.id,
          kind: "labels",
          signature: labelSig,
        })
        if (isEcho) {
          setResponseStatus(event, 202)
          return { ok: true, echo: true }
        }

        const { priority, tags } = parseGithubLabels(issueLabels, linked.gi.defaultLabels)

        const priorityChanged = priority !== null && priority !== linked.r.priority
        const currentTagSet = new Set(linked.r.tags)
        const desiredTagSet = new Set(tags)
        const addedTags = tags.filter((t) => !currentTagSet.has(t))
        const removedTags = linked.r.tags.filter((t) => !desiredTagSet.has(t))
        const tagsChanged = addedTags.length > 0 || removedTags.length > 0

        if (priorityChanged || tagsChanged) {
          const nextPriority = priority ?? linked.r.priority
          await db.transaction(async (tx) => {
            await tx
              .update(reports)
              .set({
                ...(priorityChanged ? { priority: nextPriority } : {}),
                ...(tagsChanged ? { tags } : {}),
                updatedAt: new Date(),
              })
              .where(eq(reports.id, linked.r.id))

            const eventsToInsert: (typeof reportEvents.$inferInsert)[] = []

            if (priorityChanged) {
              eventsToInsert.push({
                reportId: linked.r.id,
                projectId: linked.r.projectId,
                actorId: null,
                kind: "priority_changed",
                payload: { from: linked.r.priority, to: priority, source: "github" },
              })
            }
            for (const tag of addedTags) {
              eventsToInsert.push({
                reportId: linked.r.id,
                projectId: linked.r.projectId,
                actorId: null,
                kind: "tag_added",
                payload: { name: tag, source: "github" },
              })
            }
            for (const tag of removedTags) {
              eventsToInsert.push({
                reportId: linked.r.id,
                projectId: linked.r.projectId,
                actorId: null,
                kind: "tag_removed",
                payload: { name: tag, source: "github" },
              })
            }

            if (eventsToInsert.length > 0) {
              await tx.insert(reportEvents).values(eventsToInsert)
            }
          })
          publishReportStream(linked.r.id, { kind: "triage", payload: { source: "github" } })
        }
      } else if (p.action === "assigned" || p.action === "unassigned") {
        const linked = await findLinkedReport(
          p.issue.number,
          p.repository.owner.login,
          p.repository.name,
        )
        if (!linked) {
          setResponseStatus(event, 202)
          return { ok: true }
        }

        // Write-lock echo check — signature over the full post-event assignee set
        const currentAssigneeLogins = (p.issue.assignees ?? []).map((a) => a.login)
        const assigneeSig = signAssignees(currentAssigneeLogins)
        const isEcho = await consumeWriteLock(db, {
          reportId: linked.r.id,
          kind: "assignees",
          signature: assigneeSig,
        })
        if (isEcho) {
          setResponseStatus(event, 202)
          return { ok: true, echo: true }
        }

        await applyInboundAssignees(linked.r.id, linked.r.projectId, p.issue.assignees ?? [])
        publishReportStream(linked.r.id, { kind: "triage", payload: { source: "github" } })
      } else if (p.action === "milestoned" || p.action === "demilestoned") {
        const linked = await findLinkedReport(
          p.issue.number,
          p.repository.owner.login,
          p.repository.name,
        )
        if (!linked) {
          setResponseStatus(event, 202)
          return { ok: true }
        }

        const milestoneNumber = p.issue.milestone?.number ?? null
        const milestoneTitle = p.issue.milestone?.title ?? null

        // Write-lock echo check
        const milestoneSig = signMilestone(milestoneNumber)
        const isEcho = await consumeWriteLock(db, {
          reportId: linked.r.id,
          kind: "milestone",
          signature: milestoneSig,
        })
        if (isEcho) {
          setResponseStatus(event, 202)
          return { ok: true, echo: true }
        }

        await db.transaction(async (tx) => {
          await tx
            .update(reports)
            .set({
              milestoneNumber,
              milestoneTitle,
              updatedAt: new Date(),
            })
            .where(eq(reports.id, linked.r.id))
          await tx.insert(reportEvents).values({
            reportId: linked.r.id,
            projectId: linked.r.projectId,
            actorId: null,
            kind: "milestone_changed",
            payload: {
              from: { number: linked.r.milestoneNumber, title: linked.r.milestoneTitle },
              to:
                milestoneNumber !== null
                  ? { number: milestoneNumber, title: milestoneTitle }
                  : null,
              source: "github",
            },
          })
        })
        publishReportStream(linked.r.id, { kind: "triage", payload: { source: "github" } })
      } else if (p.action === "edited" && p.changes?.title) {
        const linked = await findLinkedReport(
          p.issue.number,
          p.repository.owner.login,
          p.repository.name,
        )
        if (!linked) {
          setResponseStatus(event, 202)
          return { ok: true }
        }

        const newTitle = p.issue.title

        // Write-lock echo check
        const titleSig = signTitle(newTitle)
        const isEcho = await consumeWriteLock(db, {
          reportId: linked.r.id,
          kind: "title",
          signature: titleSig,
        })
        if (isEcho) {
          setResponseStatus(event, 202)
          return { ok: true, echo: true }
        }

        if (linked.r.title !== newTitle) {
          await db
            .update(reports)
            .set({ title: newTitle, updatedAt: new Date() })
            .where(eq(reports.id, linked.r.id))
          publishReportStream(linked.r.id, { kind: "triage", payload: { source: "github" } })
        }
      }
    } else if (kind === "issue_comment") {
      const p = payload as IssueCommentPayload
      const action = p.action
      const comment = p.comment
      const repoOwner = p.repository.owner.login
      const repoName = p.repository.name

      const linked = await findLinkedReport(p.issue.number, repoOwner, repoName)
      if (!linked) {
        setResponseStatus(event, 202)
        return { ok: true }
      }

      const commentBody = comment.body ?? ""
      const githubUser = comment.user

      if (action === "created" || action === "edited") {
        const commentUpsertSig = signCommentUpsert(comment.id, commentBody)
        const isEcho = await consumeWriteLock(db, {
          reportId: linked.r.id,
          kind: "comment_upsert",
          signature: commentUpsertSig,
        })
        if (isEcho) {
          setResponseStatus(event, 202)
          return { ok: true, echo: true }
        }

        const body = stripBotFooter(commentBody, env.BETTER_AUTH_SECRET)
        const resolved = githubUser
          ? await resolveGithubUser(String(githubUser.id), githubUser.login, githubUser.avatar_url)
          : null

        if (action === "created") {
          // Our own comment can echo back before reconcile has stored its
          // github_comment_id: the write-lock is only recorded after
          // createComment returns, so a fast webhook beats it and used to
          // insert a duplicate github-sourced row (and the reconcile's later
          // UPDATE then hit the unique constraint and retried, posting more
          // copies). Link the pending dashboard comment instead.
          const [pendingOurs] = await db
            .select({ id: reportComments.id })
            .from(reportComments)
            .where(
              and(
                eq(reportComments.reportId, linked.r.id),
                eq(reportComments.source, "dashboard"),
                isNull(reportComments.githubCommentId),
                isNull(reportComments.deletedAt),
                eq(reportComments.body, body),
              ),
            )
            .orderBy(desc(reportComments.createdAt))
            .limit(1)
          if (pendingOurs) {
            let adopted: { id: string }[] = []
            try {
              adopted = await db
                .update(reportComments)
                .set({ githubCommentId: comment.id, updatedAt: new Date() })
                .where(
                  and(
                    eq(reportComments.id, pendingOurs.id),
                    isNull(reportComments.githubCommentId),
                  ),
                )
                .returning({ id: reportComments.id })
            } catch (err) {
              // Lost a race with the reconcile side, which has already linked
              // or recorded this id — fall through to the idempotent insert.
              if (!isUniqueViolation(err)) throw err
            }
            if (adopted.length > 0) {
              setResponseStatus(event, 202)
              return { ok: true, linked: adopted[0]?.id }
            }
          }
          await db
            .insert(reportComments)
            .values({
              reportId: linked.r.id,
              userId: resolved?.kind === "dashboard-user" ? resolved.userId : null,
              githubLogin: githubUser?.login ?? null,
              body,
              githubCommentId: comment.id,
              source: "github",
            })
            .onConflictDoNothing()
          await db.insert(reportEvents).values({
            reportId: linked.r.id,
            projectId: linked.r.projectId,
            actorId: null,
            kind: "comment_added",
            payload: { githubCommentId: comment.id, source: "github" },
          })
          publishReportStream(linked.r.id, {
            kind: "comment_added",
            payload: { source: "github", githubCommentId: comment.id },
          })
        } else {
          // edited
          await db
            .update(reportComments)
            .set({ body, updatedAt: new Date() })
            .where(eq(reportComments.githubCommentId, comment.id))
          await db.insert(reportEvents).values({
            reportId: linked.r.id,
            projectId: linked.r.projectId,
            actorId: null,
            kind: "comment_edited",
            payload: { githubCommentId: comment.id, source: "github" },
          })
          publishReportStream(linked.r.id, {
            kind: "comment_edited",
            payload: { source: "github", githubCommentId: comment.id },
          })
        }
      } else if (action === "deleted") {
        const commentDeleteSig = signCommentDelete(comment.id)
        const isEcho = await consumeWriteLock(db, {
          reportId: linked.r.id,
          kind: "comment_delete",
          signature: commentDeleteSig,
        })
        if (isEcho) {
          setResponseStatus(event, 202)
          return { ok: true, echo: true }
        }

        await db
          .update(reportComments)
          .set({ deletedAt: new Date(), updatedAt: new Date() })
          .where(eq(reportComments.githubCommentId, comment.id))
        await db.insert(reportEvents).values({
          reportId: linked.r.id,
          projectId: linked.r.projectId,
          actorId: null,
          kind: "comment_deleted",
          payload: { githubCommentId: comment.id, source: "github" },
        })
        publishReportStream(linked.r.id, {
          kind: "comment_deleted",
          payload: { source: "github", githubCommentId: comment.id },
        })
      }
    }
  } catch (err) {
    await forgetDelivery(deliveryId).catch((e) =>
      console.error(`[github-webhook] failed to release delivery ${deliveryId}`, e),
    )
    throw err
  }

  setResponseStatus(event, 202)
  return { ok: true }
})
