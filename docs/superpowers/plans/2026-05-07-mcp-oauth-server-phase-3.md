# MCP OAuth Server — Phase 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the **write surface** to MCP — `repro_update_ticket`, `repro_add_comment`, `repro_link_github_issue`, `repro_unlink_github_issue` — plus the `actor_client_id` audit column and the `/settings/mcp` connected-apps page. After Phase 3, an AI client can complete the full triage workflow (read + change + comment + link/unlink GH) and the user can disconnect any MCP client from the dashboard UI.

**Architecture:** Existing dashboard PATCH/POST endpoints have their core mutation logic extracted into reusable service functions in `server/lib/triage.ts`, `server/lib/comments.ts`, and `server/lib/github-link.ts`. Both the dashboard endpoints and the MCP tools call those service functions, so audit logging, GitHub sync, and event emission go through one path. The `actor_client_id` column threads through `report_events` and `report_comments` (NULL for UI writes, populated from OAuth `client_id` for MCP writes). The settings page reads from `oauth-provider`'s consent table to enumerate connected apps.

**Tech Stack:** Bun, Nuxt 4 / Nitro, drizzle-orm, Zod, `@modelcontextprotocol/sdk`, Nuxt UI v3. Postgres dev DB at port 5436. oxlint pinned to 1.59.0.

**Spec:** [`docs/superpowers/specs/2026-05-06-mcp-oauth-server-design.md`](../specs/2026-05-06-mcp-oauth-server-design.md) — §5 (write tools), §7 (audit trail), §8 (UI surface).

**Predecessors:**
- Phase 1: [`2026-05-06-mcp-oauth-server-phase-1.md`](2026-05-06-mcp-oauth-server-phase-1.md) — OAuth + 2 read tools.
- Phase 2: [`2026-05-06-mcp-oauth-server-phase-2.md`](2026-05-06-mcp-oauth-server-phase-2.md) — 7 more read tools.

**Out of scope (deferred to Phase 4):**
- VitePress docs page covering "how to connect Claude Desktop / Cursor / ChatGPT".
- `MCP_ENABLED=true` flag flip default.
- CHANGELOG migration note.

---

## Decisions baked into this plan

| Decision | Choice | Rationale |
|---|---|---|
| Severity field in update | **Drop** | No `severity` column in schema; `priority` covers triage axis. |
| Assignee semantics | **Full-replace `string[]`** of GitHub logins | Mirrors `TriagePatchInput` from `@reprojs/shared` — no second pattern to maintain. |
| Audit column | **Both `report_events` and `report_comments`** get `actor_client_id text` | Comments insert directly to `report_comments`; events go to `report_events`. Need both for complete audit. |
| Service-layer rule | **MCP tools call service functions, not raw DB** | Single write path; no audit/sync drift between UI and MCP. |
| Link to existing GH issue | **Set columns + enqueue sync** | Async, consistent with rest of GitHub sync. Validation happens on next reconciler tick. |
| `github_linked` event kind | **Add to enum via same migration** | Symmetric with existing `github_unlinked`. |

---

## File Structure

| Path | Status | Responsibility |
|---|---|---|
| `apps/dashboard/server/db/schema/report-events.ts` | modify | Add `actorClientId` column, add `github_linked` to enum. |
| `apps/dashboard/server/db/schema/report-comments.ts` | modify | Add `actorClientId` column. |
| `apps/dashboard/server/db/migrations/00XX_*.sql` | regenerate | One migration via `bun run db:gen`. |
| `apps/dashboard/server/lib/triage.ts` | create | `applyTicketTriagePatch(tx, args) → result` extracted from PATCH endpoint. |
| `apps/dashboard/server/lib/comments.ts` | create | `addReportComment(tx, args) → comment` extracted from comment POST endpoint. |
| `apps/dashboard/server/lib/github-link.ts` | create | `linkReportToGithubIssue(tx, args)` and `unlinkReportFromGithubIssue(tx, args)` — extracted/built. |
| `apps/dashboard/server/api/projects/[id]/reports/[reportId]/index.patch.ts` | modify | Become a thin wrapper around `applyTicketTriagePatch`, passes `actorClientId: null`. |
| `apps/dashboard/server/api/projects/[id]/reports/[reportId]/comments/index.post.ts` | modify | Thin wrapper around `addReportComment`. |
| `apps/dashboard/server/api/projects/[id]/reports/[reportId]/github-unlink.post.ts` | modify | Thin wrapper around `unlinkReportFromGithubIssue`. |
| `apps/dashboard/server/mcp/tools/writes.ts` | create | All 4 write tools: `updateTicketTool`, `addCommentTool`, `linkGithubIssueTool`, `unlinkGithubIssueTool`. |
| `apps/dashboard/server/mcp/server.ts` | modify | Register the 4 new tools. |
| `apps/dashboard/server/api/me/mcp-connections.get.ts` | create | Lists OAuth consents for the current user. |
| `apps/dashboard/server/api/me/mcp-connections/[clientId].delete.ts` | create | Revoke an MCP connection (deletes consent + active tokens). |
| `apps/dashboard/app/pages/settings/mcp.vue` | create | Settings page: connect-an-AI snippets + connected-apps list. |
| `apps/dashboard/tests/api/mcp-writes.test.ts` | create | Integration test exercising each write tool. |

**Why one `writes.ts` instead of split:** the 4 write tools share input parsing (`TriagePatchInput`-derived schemas), error handling, and the actor-client-id propagation. Co-locating them keeps the boilerplate visible in one place. Reads were split across multiple files because they touched different DB tables; writes all go through service functions.

---

## Conventions reused from Phases 1–2

- Tool shape: `export const xyzTool = { name, config: { description, inputSchema }, handler(input, ctx) }`.
- Permission gates: `requireProjectRoleByUser(ctx.userId, projectId, "manager")` for triage updates / linking; same for comments (matches the existing dashboard endpoint's manager gate).
- All MCP service-function calls receive `actorClientId: ctx.clientId` (string from OAuth JWT).
- All dashboard endpoint calls receive `actorClientId: null`.
- MCP tool errors use `mcpError(code, message)` from `mcp/errors.ts`.
- Conventional Commits, one concern per commit, `bun test` for tests, oxlint pinned at 1.59.0.

---

## Task 1: Schema migration — `actor_client_id` + `github_linked` enum

**Files:**
- Modify: `apps/dashboard/server/db/schema/report-events.ts`
- Modify: `apps/dashboard/server/db/schema/report-comments.ts`
- New: `apps/dashboard/server/db/migrations/00XX_*.sql` (regenerated)

- [ ] **Step 1: Edit `report-events.ts`.**

Find the `kind` enum array — it currently includes:
```ts
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
```

Add `"github_linked"` to the array (alphabetical order is not enforced; placing it next to `github_unlinked` makes review easier).

Then add the new column **before the `payload` field**:
```ts
actorClientId: text("actor_client_id"),
```

- [ ] **Step 2: Edit `report-comments.ts`.**

Add the same column **before the `body` field**:
```ts
actorClientId: text("actor_client_id"),
```

- [ ] **Step 3: Generate migration.**

```bash
MCP_ENABLED=true bun run db:gen
```

If `db:gen` fails on the auth:gen path, run drizzle-kit generate directly from the dashboard:

```bash
cd apps/dashboard && bun --env-file=../../.env ./node_modules/drizzle-kit/bin.cjs generate
```

Inspect the new migration file (something like `0017_*.sql`). Verify it ONLY contains:
- `ALTER TABLE "report_events" ADD COLUMN "actor_client_id" text;`
- `ALTER TABLE "report_comments" ADD COLUMN "actor_client_id" text;`
- An `ALTER TYPE` or check-constraint update adding `github_linked`.

If it tries to drop or alter unrelated columns, abort and ask.

- [ ] **Step 4: Apply.**

```bash
cd apps/dashboard && bun --env-file=../../.env ./node_modules/drizzle-kit/bin.cjs push --force
```

Verify with:
```bash
docker exec repro-postgres-1 psql -U postgres -d repro -c "\d report_events" | grep actor_client_id
docker exec repro-postgres-1 psql -U postgres -d repro -c "\d report_comments" | grep actor_client_id
```

Both should return a row mentioning `actor_client_id`.

- [ ] **Step 5: Commit.**

```bash
git add apps/dashboard/server/db/schema/report-events.ts \
        apps/dashboard/server/db/schema/report-comments.ts \
        apps/dashboard/server/db/migrations/
git commit -m "feat(db): add actor_client_id audit column + github_linked event kind"
```

---

## Task 2: Extract `applyTicketTriagePatch` service function

**Files:**
- Create: `apps/dashboard/server/lib/triage.ts`
- Modify: `apps/dashboard/server/api/projects/[id]/reports/[reportId]/index.patch.ts`

The existing PATCH endpoint runs in a `db.transaction(async (tx) => { ... })`. Extract the transaction body into a pure-ish function that takes `tx` + the args, with `actorClientId` threaded through.

- [ ] **Step 1: Read the existing PATCH endpoint** at `apps/dashboard/server/api/projects/[id]/reports/[reportId]/index.patch.ts` end-to-end. Identify the section between the `db.transaction(async (tx) => {` line and the closing `})` — that's the body to extract. Note: it imports `buildReportEvents`, `enqueueSync`, `publishReportStream`. Those imports stay in the new lib file.

- [ ] **Step 2: Create the service function.**

```ts
// apps/dashboard/server/lib/triage.ts
import type { PgTransaction } from "drizzle-orm/pg-core"
import type { TriagePatchInput } from "@reprojs/shared"

export interface ApplyTicketTriagePatchArgs {
  projectId: string
  reportId: string
  actorId: string
  actorClientId: string | null
  body: TriagePatchInput
}

export interface ApplyTicketTriagePatchResult {
  updated: { id: string; status: string; priority: string; tags: string[] }
  events: Array<{ kind: string; payload: Record<string, unknown> }>
}

/**
 * Apply a triage patch (status / priority / tags / assignees / milestone)
 * inside a transaction. Used by:
 *   - The dashboard PATCH endpoint (actorClientId: null)
 *   - MCP repro_update_ticket (actorClientId: OAuth client_id)
 *
 * Throws via h3's createError on:
 *   - 404 if the report doesn't exist or doesn't belong to projectId
 *   - 409 if the body asks to mutate GitHub-mirrored fields (assignees / milestone)
 *     and the report is not linked or the integration is not connected
 *
 * Side effects (all transactional):
 *   - Updates `reports` row
 *   - Inserts `report_assignees` rows (delta) when assignees change
 *   - Inserts `report_events` rows for each change (with actorClientId)
 *   - Enqueues a GitHub sync job when push-on-edit is enabled
 *   - Publishes a SSE event via publishReportStream
 *
 * The body is the same Zod-validated shape the dashboard PATCH accepts.
 */
export async function applyTicketTriagePatch(
  tx: PgTransaction<any, any, any>,
  args: ApplyTicketTriagePatchArgs,
): Promise<ApplyTicketTriagePatchResult> {
  // BODY MOVED FROM apps/dashboard/server/api/projects/[id]/reports/[reportId]/index.patch.ts
  // ...full transaction body inline here, with the following adaptations:
  //   - Replace `id` (route param) with args.projectId
  //   - Replace `reportId` (route param) with args.reportId
  //   - Replace `session.userId` with args.actorId
  //   - Pass `actorClientId: args.actorClientId` to every `tx.insert(reportEvents).values({...})`
  //   - Replace `body` with args.body
  //   - Return { updated, events } at the bottom (the existing endpoint returns
  //     this shape inside the transaction's resolution; preserve it)
}
```

> The implementer's job: copy the entire transaction body verbatim from the PATCH endpoint, adapt the variable names per the comment block, and add `actorClientId: args.actorClientId` to every `reportEvents` insert. **Do not refactor the body's logic** — preserve behavior exactly.

> The `PgTransaction<any, any, any>` type signature is the standard pattern in this codebase for transaction-receiving helpers. If a more specific generic exists, use it.

- [ ] **Step 3: Replace the PATCH endpoint with a thin wrapper.**

The PATCH endpoint's new body becomes:

```ts
// apps/dashboard/server/api/projects/[id]/reports/[reportId]/index.patch.ts
import { createError, defineEventHandler, getRouterParam, readValidatedBody } from "h3"
import { TriagePatchInput } from "@reprojs/shared"
import { db } from "../../../../../db"
import { applyTicketTriagePatch } from "../../../../../lib/triage"
import { requireProjectRole } from "../../../../../lib/permissions"

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id")
  const reportId = getRouterParam(event, "reportId")
  if (!id || !reportId) throw createError({ statusCode: 400, statusMessage: "missing params" })
  const { session } = await requireProjectRole(event, id, "manager")
  const body = await readValidatedBody(event, (b: unknown) => TriagePatchInput.parse(b))

  return await db.transaction(async (tx) =>
    applyTicketTriagePatch(tx, {
      projectId: id,
      reportId,
      actorId: session.userId,
      actorClientId: null,
      body,
    }),
  )
})
```

(Drop unused imports — drizzle helpers, schema imports — they're now only needed in `triage.ts`.)

- [ ] **Step 4: Run existing tests to confirm nothing regressed.**

```bash
bun test apps/dashboard/tests/api/inbox.test.ts apps/dashboard/tests/api/manager-role.test.ts
```

Expected: all existing tests pass. If a test fails, the extraction broke something — investigate before continuing.

(Note: these tests need the dev server running. Start it the same way as Phase 2's integration tests.)

- [ ] **Step 5: Commit.**

```bash
git add apps/dashboard/server/lib/triage.ts \
        apps/dashboard/server/api/projects/\[id\]/reports/\[reportId\]/index.patch.ts
git commit -m "refactor(triage): extract applyTicketTriagePatch service function"
```

---

## Task 3: Extract `addReportComment` service function

**Files:**
- Create: `apps/dashboard/server/lib/comments-service.ts`
- Modify: `apps/dashboard/server/api/projects/[id]/reports/[reportId]/comments/index.post.ts`

> Filename is `comments-service.ts` not `comments.ts` to avoid conflict with the existing `comment-serializer.ts` in the same directory and any other comment-named file.

Same pattern as Task 2 — extract the comment POST's transaction body into a reusable function with `actorClientId` threaded through.

- [ ] **Step 1: Read** the existing comment POST endpoint end-to-end.

- [ ] **Step 2: Create the service function.**

```ts
// apps/dashboard/server/lib/comments-service.ts
import type { PgTransaction } from "drizzle-orm/pg-core"

export interface AddReportCommentArgs {
  projectId: string
  reportId: string
  actorId: string
  actorClientId: string | null
  body: string // markdown, 1..65536 chars
}

export interface AddReportCommentResult {
  id: string
  body: string
  createdAt: Date
}

/**
 * Insert a dashboard-source comment on a report. Used by:
 *   - The dashboard POST endpoint (actorClientId: null)
 *   - MCP repro_add_comment (actorClientId: OAuth client_id)
 *
 * Throws 404 if the report doesn't exist or doesn't match projectId.
 *
 * Side effects:
 *   - Inserts report_comments row (source: "dashboard", actorClientId from args)
 *   - Inserts report_events row of kind "comment_added" (with actorClientId)
 *   - Enqueues comment-upsert sync job if a GitHub integration is connected
 *   - Publishes SSE event
 */
export async function addReportComment(
  tx: PgTransaction<any, any, any>,
  args: AddReportCommentArgs,
): Promise<AddReportCommentResult> {
  // BODY MOVED FROM the comment POST endpoint, with the same adaptations:
  //   - Replace route params with args.projectId / args.reportId
  //   - Replace session.userId with args.actorId
  //   - Add actorClientId: args.actorClientId to BOTH the reportComments insert
  //     AND the reportEvents insert
  //   - args.body replaces the validated body
}
```

- [ ] **Step 3: Replace the POST endpoint with a thin wrapper.**

```ts
import { createError, defineEventHandler, getRouterParam, readValidatedBody, setResponseStatus } from "h3"
import { z } from "zod"
import { db } from "../../../../../../db"
import { addReportComment } from "../../../../../../lib/comments-service"
import { requireProjectRole } from "../../../../../../lib/permissions"

const CreateCommentBody = z.object({ body: z.string().min(1).max(65_536) })

export default defineEventHandler(async (event) => {
  const projectId = getRouterParam(event, "id")
  const reportId = getRouterParam(event, "reportId")
  if (!projectId || !reportId) throw createError({ statusCode: 400, statusMessage: "Missing ids" })
  const { session } = await requireProjectRole(event, projectId, "manager")
  const { body } = await readValidatedBody(event, (b) => CreateCommentBody.parse(b))

  const result = await db.transaction(async (tx) =>
    addReportComment(tx, {
      projectId,
      reportId,
      actorId: session.userId,
      actorClientId: null,
      body,
    }),
  )
  setResponseStatus(event, 201)
  return result
})
```

- [ ] **Step 4: Run existing comment tests.**

```bash
bun test apps/dashboard/tests/api/comments.test.ts apps/dashboard/tests/api/github-comment-roundtrip.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit.**

```bash
git add apps/dashboard/server/lib/comments-service.ts \
        apps/dashboard/server/api/projects/\[id\]/reports/\[reportId\]/comments/index.post.ts
git commit -m "refactor(comments): extract addReportComment service function"
```

---

## Task 4: Extract / build GitHub link & unlink service functions

**Files:**
- Create: `apps/dashboard/server/lib/github-link.ts`
- Modify: `apps/dashboard/server/api/projects/[id]/reports/[reportId]/github-unlink.post.ts`

`unlinkReportFromGithubIssue` extracts the existing logic; `linkReportToGithubIssue` is new (no existing UI path links to an existing GitHub issue today).

- [ ] **Step 1: Read** the existing `github-unlink.post.ts` end-to-end.

- [ ] **Step 2: Create the service module.**

```ts
// apps/dashboard/server/lib/github-link.ts
import { and, eq } from "drizzle-orm"
import type { PgTransaction } from "drizzle-orm/pg-core"
import { createError } from "h3"
import {
  githubIntegrations,
  reportEvents,
  reports,
  reportSyncJobs,
} from "../db/schema"
import { enqueueSync } from "./enqueue-sync"

export interface LinkArgs {
  projectId: string
  reportId: string
  actorId: string
  actorClientId: string | null
}

export interface LinkToIssueArgs extends LinkArgs {
  repoOwner: string
  repoName: string
  issueNumber: number
}

/**
 * Link a Repro report to an existing GitHub issue. Sets reports.githubIssueNumber/Url
 * and inserts a report_events row of kind "github_linked". Enqueues a sync job
 * which will pull the issue's current state (labels, assignees, status) on the
 * next reconciler tick — that's also where we surface "issue does not exist on
 * GitHub" type errors. We don't validate against the GitHub API here.
 *
 * Throws:
 *   - 404 if report doesn't exist / doesn't match projectId
 *   - 409 if no connected GitHub integration on the project
 *   - 409 if the report is already linked to a different issue (caller must unlink first)
 */
export async function linkReportToGithubIssue(
  tx: PgTransaction<any, any, any>,
  args: LinkToIssueArgs,
): Promise<{ linked: true; issueNumber: number; issueUrl: string }> {
  const [current] = await tx
    .select({
      id: reports.id,
      githubIssueNumber: reports.githubIssueNumber,
    })
    .from(reports)
    .where(and(eq(reports.id, args.reportId), eq(reports.projectId, args.projectId)))
    .limit(1)
  if (!current) throw createError({ statusCode: 404, statusMessage: "report not found" })

  const [integration] = await tx
    .select({ status: githubIntegrations.status })
    .from(githubIntegrations)
    .where(eq(githubIntegrations.projectId, args.projectId))
    .limit(1)
  if (!integration || integration.status !== "connected") {
    throw createError({ statusCode: 409, statusMessage: "Project is not connected to GitHub" })
  }

  if (current.githubIssueNumber !== null && current.githubIssueNumber !== args.issueNumber) {
    throw createError({
      statusCode: 409,
      statusMessage: `Report already linked to issue #${current.githubIssueNumber}; unlink first`,
    })
  }

  const issueUrl = `https://github.com/${args.repoOwner}/${args.repoName}/issues/${args.issueNumber}`
  await tx
    .update(reports)
    .set({
      githubIssueNumber: args.issueNumber,
      githubIssueUrl: issueUrl,
      updatedAt: new Date(),
    })
    .where(eq(reports.id, args.reportId))

  await tx.insert(reportEvents).values({
    reportId: args.reportId,
    projectId: args.projectId,
    actorId: args.actorId,
    actorClientId: args.actorClientId,
    kind: "github_linked",
    payload: { repoOwner: args.repoOwner, repoName: args.repoName, number: args.issueNumber, url: issueUrl },
  })

  await enqueueSync(tx, args.reportId, "edit")

  return { linked: true, issueNumber: args.issueNumber, issueUrl }
}

/**
 * Unlink a report from its current GitHub issue. Idempotent — returns
 * { unlinked: false } if nothing was linked.
 */
export async function unlinkReportFromGithubIssue(
  tx: PgTransaction<any, any, any>,
  args: LinkArgs,
): Promise<{ ok: true; unlinked: boolean }> {
  const [current] = await tx
    .select()
    .from(reports)
    .where(and(eq(reports.id, args.reportId), eq(reports.projectId, args.projectId)))
    .limit(1)
  if (!current) throw createError({ statusCode: 404, statusMessage: "report not found" })
  if (current.githubIssueNumber == null) return { ok: true, unlinked: false }

  await tx
    .update(reports)
    .set({
      githubIssueNumber: null,
      githubIssueNodeId: null,
      githubIssueUrl: null,
      updatedAt: new Date(),
    })
    .where(eq(reports.id, args.reportId))

  await tx.delete(reportSyncJobs).where(eq(reportSyncJobs.reportId, args.reportId))

  await tx.insert(reportEvents).values({
    reportId: args.reportId,
    projectId: args.projectId,
    actorId: args.actorId,
    actorClientId: args.actorClientId,
    kind: "github_unlinked",
    payload: { number: current.githubIssueNumber, url: current.githubIssueUrl },
  })

  return { ok: true, unlinked: true }
}
```

> The `enqueueSync(tx, reportId, "edit")` call in `linkReportToGithubIssue` matches the existing convention — verify the signature in `apps/dashboard/server/lib/enqueue-sync.ts` and adjust if different. If the function takes different args (e.g. just `reportId`), use that signature.

- [ ] **Step 3: Replace `github-unlink.post.ts` with a thin wrapper.**

```ts
import { createError, defineEventHandler, getRouterParam } from "h3"
import { db } from "../../../../../db"
import { unlinkReportFromGithubIssue } from "../../../../../lib/github-link"
import { requireProjectRole } from "../../../../../lib/permissions"

export default defineEventHandler(async (event) => {
  const projectId = getRouterParam(event, "id")
  const reportId = getRouterParam(event, "reportId")
  if (!projectId || !reportId) throw createError({ statusCode: 400, statusMessage: "missing params" })
  const { session } = await requireProjectRole(event, projectId, "manager")

  return await db.transaction(async (tx) =>
    unlinkReportFromGithubIssue(tx, {
      projectId,
      reportId,
      actorId: session.userId,
      actorClientId: null,
    }),
  )
})
```

- [ ] **Step 4: Run existing GitHub tests.**

```bash
bun test apps/dashboard/tests/api/github-sync.test.ts apps/dashboard/tests/api/github-app-delete.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit.**

```bash
git add apps/dashboard/server/lib/github-link.ts \
        apps/dashboard/server/api/projects/\[id\]/reports/\[reportId\]/github-unlink.post.ts
git commit -m "refactor(github): extract link/unlink service functions"
```

---

## Task 5: MCP write tools — `tools/writes.ts`

**Files:**
- Create: `apps/dashboard/server/mcp/tools/writes.ts`

All 4 write tools in one file. They share the `requireProjectRoleByUser(..., "manager")` gate, the `actorClientId: ctx.clientId` propagation, and the service-function-call pattern.

- [ ] **Step 1: Create the file.**

```ts
// apps/dashboard/server/mcp/tools/writes.ts
import { z } from "zod"
import { eq } from "drizzle-orm"
import { TriagePatchInput } from "@reprojs/shared"
import { db } from "../../db"
import { reports } from "../../db/schema"
import { requireProjectRoleByUser } from "../../lib/permissions"
import { mcpError } from "../errors"
import { applyTicketTriagePatch } from "../../lib/triage"
import { addReportComment } from "../../lib/comments-service"
import {
  linkReportToGithubIssue,
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
        .union([
          z.object({ number: z.number().int(), title: z.string() }),
          z.null(),
        ])
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

    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
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

    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
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
```

- [ ] **Step 2: Lint.** `bunx oxlint apps/dashboard/server/mcp/tools/writes.ts` — 0 errors.

- [ ] **Step 3: Commit.**

```bash
git add apps/dashboard/server/mcp/tools/writes.ts
git commit -m "feat(mcp): add 4 write tools (update/comment/link/unlink)"
```

---

## Task 6: Register write tools in `server.ts`

**Files:**
- Modify: `apps/dashboard/server/mcp/server.ts`

- [ ] **Step 1: Add imports.**

```ts
import {
  updateTicketTool,
  addCommentTool,
  linkGithubIssueTool,
  unlinkGithubIssueTool,
} from "./tools/writes"
```

- [ ] **Step 2: Add 4 `server.registerTool` calls** following the exact pattern of the Phase 2 registrations. Append after the last existing registration (the Phase 2 `getTicketCookiesTool` block):

```ts
  server.registerTool(
    updateTicketTool.name,
    updateTicketTool.config,
    async (input) => {
      try {
        return await updateTicketTool.handler(
          input as Parameters<typeof updateTicketTool.handler>[0],
          ctx,
        )
      } catch (err) {
        return toolErrorResult(err)
      }
    },
  )

  server.registerTool(
    addCommentTool.name,
    addCommentTool.config,
    async (input) => {
      try {
        return await addCommentTool.handler(
          input as Parameters<typeof addCommentTool.handler>[0],
          ctx,
        )
      } catch (err) {
        return toolErrorResult(err)
      }
    },
  )

  server.registerTool(
    linkGithubIssueTool.name,
    linkGithubIssueTool.config,
    async (input) => {
      try {
        return await linkGithubIssueTool.handler(
          input as Parameters<typeof linkGithubIssueTool.handler>[0],
          ctx,
        )
      } catch (err) {
        return toolErrorResult(err)
      }
    },
  )

  server.registerTool(
    unlinkGithubIssueTool.name,
    unlinkGithubIssueTool.config,
    async (input) => {
      try {
        return await unlinkGithubIssueTool.handler(
          input as Parameters<typeof unlinkGithubIssueTool.handler>[0],
          ctx,
        )
      } catch (err) {
        return toolErrorResult(err)
      }
    },
  )
```

- [ ] **Step 3: Lint.** `bunx oxlint apps/dashboard/server/mcp/server.ts` — 0 errors.

- [ ] **Step 4: Commit.**

```bash
git add apps/dashboard/server/mcp/server.ts
git commit -m "feat(mcp): register Phase 3 write tools in McpServer factory"
```

---

## Task 7: Connected-apps API

**Files:**
- Create: `apps/dashboard/server/api/me/mcp-connections.get.ts`
- Create: `apps/dashboard/server/api/me/mcp-connections/[clientId].delete.ts`

Lists OAuth consents owned by the current user; lets them disconnect any one.

- [ ] **Step 1: Create the GET endpoint.**

```ts
// apps/dashboard/server/api/me/mcp-connections.get.ts
import { defineEventHandler } from "h3"
import { eq, desc } from "drizzle-orm"
import { db } from "../../db"
import { oauthConsent, oauthClient, oauthAccessToken } from "../../db/schema/auth-schema"
import { requireSession } from "../../lib/permissions"

/**
 * Returns the OAuth consents (= connected MCP apps) for the current user.
 * Each entry includes the client name (from RFC 7591 registration), connected
 * date, last-used timestamp, and the scopes granted.
 */
export default defineEventHandler(async (event) => {
  const session = await requireSession(event)

  const consents = await db
    .select({
      clientId: oauthConsent.clientId,
      scopes: oauthConsent.scopes,
      createdAt: oauthConsent.createdAt,
      clientName: oauthClient.name,
    })
    .from(oauthConsent)
    .innerJoin(oauthClient, eq(oauthClient.clientId, oauthConsent.clientId))
    .where(eq(oauthConsent.userId, session.userId))
    .orderBy(desc(oauthConsent.createdAt))

  // Find last-used timestamp per client by joining the latest access token.
  const lastUsedByClient = new Map<string, Date>()
  for (const c of consents) {
    const [latest] = await db
      .select({ createdAt: oauthAccessToken.createdAt })
      .from(oauthAccessToken)
      .where(eq(oauthAccessToken.clientId, c.clientId))
      .orderBy(desc(oauthAccessToken.createdAt))
      .limit(1)
    if (latest?.createdAt) lastUsedByClient.set(c.clientId, latest.createdAt)
  }

  return {
    connections: consents.map((c) => ({
      clientId: c.clientId,
      clientName: c.clientName ?? "Unknown",
      scopes: c.scopes ?? [],
      connectedAt: c.createdAt,
      lastUsedAt: lastUsedByClient.get(c.clientId) ?? null,
    })),
  }
})
```

> **Verify column names** in the regenerated `auth-schema.ts` (Phase 1's auth:gen run created these tables). The exact column names — `oauthConsent.clientId` vs `oauth_consent.client_id` — depend on better-auth's auto-generation. Adjust the imports + property accesses to match what's actually in `auth-schema.ts`. The shape (consent row + client row + token row joined for last-used) is correct; only field names may differ.

- [ ] **Step 2: Create the DELETE endpoint.**

```ts
// apps/dashboard/server/api/me/mcp-connections/[clientId].delete.ts
import { createError, defineEventHandler, getRouterParam } from "h3"
import { and, eq } from "drizzle-orm"
import { db } from "../../../db"
import {
  oauthConsent,
  oauthAccessToken,
  oauthRefreshToken,
} from "../../../db/schema/auth-schema"
import { requireSession } from "../../../lib/permissions"

/**
 * Revoke an MCP client's access for the current user. Deletes:
 *   1. The consent grant (so future authorize attempts will re-prompt)
 *   2. All active access tokens for this (user, client) pair
 *   3. All active refresh tokens for this (user, client) pair
 *
 * Idempotent — returns { revoked: false } if no consent existed.
 */
export default defineEventHandler(async (event) => {
  const session = await requireSession(event)
  const clientId = getRouterParam(event, "clientId")
  if (!clientId) throw createError({ statusCode: 400, statusMessage: "missing clientId" })

  return await db.transaction(async (tx) => {
    const deleted = await tx
      .delete(oauthConsent)
      .where(and(eq(oauthConsent.userId, session.userId), eq(oauthConsent.clientId, clientId)))
      .returning({ clientId: oauthConsent.clientId })
    if (deleted.length === 0) return { revoked: false }

    await tx
      .delete(oauthAccessToken)
      .where(
        and(
          eq(oauthAccessToken.userId, session.userId),
          eq(oauthAccessToken.clientId, clientId),
        ),
      )
    await tx
      .delete(oauthRefreshToken)
      .where(
        and(
          eq(oauthRefreshToken.userId, session.userId),
          eq(oauthRefreshToken.clientId, clientId),
        ),
      )
    return { revoked: true }
  })
})
```

> Same caveat: confirm column names against the actual `auth-schema.ts`.

- [ ] **Step 3: Smoke-test the GET endpoint.**

Start the dev server (`MCP_ENABLED=true bun run dev`), sign in via `/sign-in`, then `curl -H 'Cookie: <session>' http://localhost:3000/api/me/mcp-connections` should return `{ connections: [] }` for a user with no connected apps. Stop the server.

- [ ] **Step 4: Lint.** `bunx oxlint apps/dashboard/server/api/me/mcp-connections.get.ts apps/dashboard/server/api/me/mcp-connections/` — 0 errors.

- [ ] **Step 5: Commit.**

```bash
git add apps/dashboard/server/api/me/mcp-connections.get.ts \
        apps/dashboard/server/api/me/mcp-connections/
git commit -m "feat(mcp): add /api/me/mcp-connections list + revoke endpoints"
```

---

## Task 8: `/settings/mcp` Vue page

**Files:**
- Create: `apps/dashboard/app/pages/settings/mcp.vue`

Two-section page: connect-an-AI snippets (with copy buttons) + connected-apps list (with disconnect buttons).

- [ ] **Step 1: Create the page.**

```vue
<script setup lang="ts">
import { computed, ref } from "vue"
import { useRequestURL } from "#imports"

definePageMeta({
  layout: "settings",
  // Auth handled by global middleware.
})

const url = useRequestURL()
const origin = computed(() => `${url.protocol}//${url.host}`)
const mcpUrl = computed(() => `${origin.value}/api/mcp`)

const claudeDesktopSnippet = computed(() =>
  JSON.stringify(
    {
      mcpServers: {
        repro: {
          command: "npx",
          args: ["-y", "mcp-remote", mcpUrl.value],
        },
      },
    },
    null,
    2,
  ),
)
const cursorSnippet = computed(() =>
  JSON.stringify(
    { mcpServers: { repro: { url: mcpUrl.value, transport: "streamable-http" } } },
    null,
    2,
  ),
)
const remoteCli = computed(() => `npx mcp-remote ${mcpUrl.value}`)

interface Connection {
  clientId: string
  clientName: string
  scopes: string[]
  connectedAt: string
  lastUsedAt: string | null
}

const { data: connections, refresh } = await useFetch<{ connections: Connection[] }>(
  "/api/me/mcp-connections",
)

const revokingClient = ref<string | null>(null)
async function revoke(clientId: string): Promise<void> {
  revokingClient.value = clientId
  try {
    await $fetch(`/api/me/mcp-connections/${clientId}`, { method: "DELETE" })
    await refresh()
  } finally {
    revokingClient.value = null
  }
}

async function copy(text: string): Promise<void> {
  await navigator.clipboard.writeText(text)
}
</script>

<template>
  <div class="space-y-8 max-w-3xl">
    <header>
      <h1 class="text-2xl font-semibold">MCP / AI assistants</h1>
      <p class="text-sm text-muted-foreground mt-1">
        Connect an AI assistant (Claude Desktop, Cursor, ChatGPT, …) to triage your Repro
        tickets through the Model Context Protocol.
      </p>
    </header>

    <section class="space-y-4">
      <h2 class="text-lg font-semibold">Connect an AI assistant</h2>

      <UCard>
        <template #header>
          <div class="flex items-center justify-between">
            <span class="font-medium">Claude Desktop</span>
            <UButton
              size="xs"
              variant="ghost"
              icon="i-lucide-copy"
              @click="copy(claudeDesktopSnippet)"
            >
              Copy
            </UButton>
          </div>
        </template>
        <p class="text-xs text-muted-foreground mb-2">
          Add to <code>~/Library/Application Support/Claude/claude_desktop_config.json</code>:
        </p>
        <pre class="text-xs bg-muted p-3 rounded overflow-auto"><code>{{ claudeDesktopSnippet }}</code></pre>
      </UCard>

      <UCard>
        <template #header>
          <div class="flex items-center justify-between">
            <span class="font-medium">Cursor</span>
            <UButton size="xs" variant="ghost" icon="i-lucide-copy" @click="copy(cursorSnippet)">
              Copy
            </UButton>
          </div>
        </template>
        <p class="text-xs text-muted-foreground mb-2">
          Add to <code>~/.cursor/mcp.json</code>:
        </p>
        <pre class="text-xs bg-muted p-3 rounded overflow-auto"><code>{{ cursorSnippet }}</code></pre>
      </UCard>

      <UCard>
        <template #header>
          <div class="flex items-center justify-between">
            <span class="font-medium">ChatGPT custom connectors</span>
          </div>
        </template>
        <p class="text-xs">
          Paste this URL into the connector dialog — discovery + OAuth happens automatically:
        </p>
        <div class="flex items-center gap-2 mt-2">
          <code class="flex-1 text-xs bg-muted p-2 rounded">{{ mcpUrl }}</code>
          <UButton size="xs" variant="ghost" icon="i-lucide-copy" @click="copy(mcpUrl)">Copy</UButton>
        </div>
      </UCard>

      <UCard>
        <template #header>
          <span class="font-medium">Generic (any MCP client)</span>
        </template>
        <p class="text-xs">Use the <code>mcp-remote</code> shim:</p>
        <div class="flex items-center gap-2 mt-2">
          <code class="flex-1 text-xs bg-muted p-2 rounded">{{ remoteCli }}</code>
          <UButton size="xs" variant="ghost" icon="i-lucide-copy" @click="copy(remoteCli)">Copy</UButton>
        </div>
      </UCard>
    </section>

    <section class="space-y-4">
      <h2 class="text-lg font-semibold">Connected apps</h2>
      <p v-if="!connections?.connections?.length" class="text-sm text-muted-foreground">
        No AI assistants connected yet.
      </p>
      <ul v-else class="space-y-2">
        <li
          v-for="c in connections.connections"
          :key="c.clientId"
          class="flex items-center justify-between border rounded p-3"
        >
          <div class="space-y-0.5">
            <div class="font-medium">{{ c.clientName }}</div>
            <div class="text-xs text-muted-foreground">
              Connected {{ new Date(c.connectedAt).toLocaleDateString() }}
              <span v-if="c.lastUsedAt">
                · last used {{ new Date(c.lastUsedAt).toLocaleString() }}
              </span>
            </div>
            <div class="text-xs text-muted-foreground">
              Scopes: {{ c.scopes.join(", ") || "(none)" }}
            </div>
          </div>
          <UButton
            size="xs"
            variant="ghost"
            color="error"
            :loading="revokingClient === c.clientId"
            @click="revoke(c.clientId)"
          >
            Disconnect
          </UButton>
        </li>
      </ul>
    </section>
  </div>
</template>
```

> If the codebase uses a settings layout other than `"settings"`, inspect the existing settings pages (`apps/dashboard/app/pages/settings/*.vue`) and match. If `useRequestURL` isn't available in this Nuxt version, fall back to `window.location.origin` inside the `computed` (only after `onMounted` to avoid SSR-empty origin).

- [ ] **Step 2: Boot the dev server and visit `/settings/mcp`.**

```bash
MCP_ENABLED=true bun run dev &
DEV_PID=$!
# Wait for ready, then visit http://localhost:3000/settings/mcp in a browser.
# Confirm: page renders, connect-an-AI snippets show with the actual dashboard URL
# substituted, copy buttons work, and connected-apps section says "No AI assistants
# connected yet" until you actually OAuth-flow Claude Desktop.
kill $DEV_PID 2>/dev/null
```

- [ ] **Step 3: Lint.** `bunx oxlint apps/dashboard/app/pages/settings/mcp.vue` — 0 errors.

- [ ] **Step 4: Commit.**

```bash
git add apps/dashboard/app/pages/settings/mcp.vue
git commit -m "feat(mcp): add /settings/mcp page (connect snippets + connected apps)"
```

---

## Task 9: Phase 3 integration tests

**Files:**
- Create: `apps/dashboard/tests/api/mcp-writes.test.ts`

Acceptance test for all 4 write tools, plus an `actor_client_id` audit assertion.

- [ ] **Step 1: Create the test file.**

```ts
// apps/dashboard/tests/api/mcp-writes.test.ts
import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { createHash, randomBytes } from "node:crypto"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { eq } from "drizzle-orm"
import { db } from "../../server/db"
import {
  projects,
  projectMembers,
  reports,
  reportComments,
  reportEvents,
  githubIntegrations,
} from "../../server/db/schema"
import { apiFetch, createUser, signIn, truncateDomain } from "../helpers"

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000"

beforeAll(() => {
  if (process.env.MCP_ENABLED !== "true") {
    throw new Error("Run integration tests with MCP_ENABLED=true (the dev server too).")
  }
})

afterAll(async () => {
  await truncateDomain()
})

function pkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url")
  const challenge = createHash("sha256").update(verifier).digest("base64url")
  return { verifier, challenge }
}

interface SetupResult {
  client: Client
  clientId: string
  userId: string
  projectId: string
  ticketId: string
}

async function setup(opts: { withGithub?: boolean } = {}): Promise<SetupResult> {
  await truncateDomain()
  const userId = await createUser("phase3-mcp@example.com")
  const cookie = await signIn("phase3-mcp@example.com")

  const projectId = crypto.randomUUID()
  await db.insert(projects).values({ id: projectId, name: "P3 Test", createdBy: userId })
  await db.insert(projectMembers).values({ projectId, userId, role: "manager" })

  if (opts.withGithub) {
    await db.insert(githubIntegrations).values({
      projectId,
      status: "connected",
      // ... fill required NOT NULL fields per the schema; the implementer should
      // mirror what the existing github tests use (see github-sync.test.ts setup).
      // This may need adjustment based on the actual schema.
    })
  }

  const ticketId = crypto.randomUUID()
  await db.insert(reports).values({
    id: ticketId,
    projectId,
    title: "Test ticket",
    status: "open",
    priority: "normal",
    tags: ["initial"],
    source: "web",
    context: { source: "web", pageUrl: "https://example.com" },
  })

  // OAuth dance — same as Phase 1/2 tests.
  const discovery = await fetch(
    `${BASE}/.well-known/oauth-authorization-server/api/auth`,
  ).then((r) => r.json())
  const reg = await fetch(discovery.registration_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "Phase3 Test Client",
      redirect_uris: [`${BASE}/oauth-test-callback`],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    }),
  }).then((r) => r.json())

  const { verifier, challenge } = pkce()
  const authorizeUrl = new URL(discovery.authorization_endpoint)
  authorizeUrl.searchParams.set("response_type", "code")
  authorizeUrl.searchParams.set("client_id", reg.client_id)
  authorizeUrl.searchParams.set("redirect_uri", `${BASE}/oauth-test-callback`)
  authorizeUrl.searchParams.set("scope", "mcp:full")
  authorizeUrl.searchParams.set("code_challenge", challenge)
  authorizeUrl.searchParams.set("code_challenge_method", "S256")
  authorizeUrl.searchParams.set("state", "test-state")
  const authorizeRes = await fetch(authorizeUrl, { headers: { cookie }, redirect: "manual" })
  let location = authorizeRes.headers.get("location") ?? ""
  if (location.includes("/oauth/consent")) {
    const oauthQuery = new URL(location, BASE).search.replace(/^\?/, "")
    const decision = await apiFetch<{ redirectUri: string }>("/api/oauth/consent", {
      method: "POST",
      headers: { cookie },
      body: { oauthQuery, allow: true },
    })
    expect(decision.status).toBe(200)
    location = decision.body.redirectUri
  }
  const code = new URL(location, BASE).searchParams.get("code")
  if (!code) throw new Error("no authorization code returned")
  const tokenRes = await fetch(discovery.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: `${BASE}/oauth-test-callback`,
      client_id: reg.client_id,
      code_verifier: verifier,
      resource: `${BASE}/api/mcp`,
    }),
  }).then((r) => r.json())

  const mcp = new Client({ name: "phase3-test-client", version: "0.0.0" })
  const transport = new StreamableHTTPClientTransport(new URL(`${BASE}/api/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${tokenRes.access_token}` } },
  })
  await mcp.connect(transport)
  return { client: mcp, clientId: reg.client_id, userId, projectId, ticketId }
}

describe("MCP Phase 3 write tools", () => {
  it("repro_update_ticket: status + priority + tags, audit row carries actor_client_id", async () => {
    const { client, clientId, ticketId } = await setup()
    try {
      await client.callTool({
        name: "repro_update_ticket",
        arguments: {
          ticketId,
          status: "in_progress",
          priority: "high",
          tags: ["initial", "frontend"],
        },
      })

      const [report] = await db.select().from(reports).where(eq(reports.id, ticketId))
      expect(report?.status).toBe("in_progress")
      expect(report?.priority).toBe("high")
      expect(report?.tags).toContain("frontend")

      const events = await db
        .select()
        .from(reportEvents)
        .where(eq(reportEvents.reportId, ticketId))
      expect(events.length).toBeGreaterThan(0)
      expect(events.every((e) => e.actorClientId === clientId)).toBe(true)
    } finally {
      await client.close()
    }
  }, 30_000)

  it("repro_add_comment: persists comment with actor_client_id", async () => {
    const { client, clientId, ticketId } = await setup()
    try {
      await client.callTool({
        name: "repro_add_comment",
        arguments: { ticketId, body: "Triaged by Claude" },
      })
      const [comment] = await db
        .select()
        .from(reportComments)
        .where(eq(reportComments.reportId, ticketId))
      expect(comment?.body).toBe("Triaged by Claude")
      expect(comment?.actorClientId).toBe(clientId)
      expect(comment?.source).toBe("dashboard")
    } finally {
      await client.close()
    }
  }, 30_000)

  it("repro_link_github_issue: 409 when project has no GitHub integration", async () => {
    const { client, ticketId } = await setup({ withGithub: false })
    try {
      const result = await client.callTool({
        name: "repro_link_github_issue",
        arguments: { ticketId, repoOwner: "acme", repoName: "frontend", issueNumber: 42 },
      })
      expect((result as { isError?: boolean }).isError).toBe(true)
    } finally {
      await client.close()
    }
  }, 30_000)

  it("repro_unlink_github_issue: idempotent on already-unlinked ticket", async () => {
    const { client, ticketId } = await setup()
    try {
      const result = await client.callTool({
        name: "repro_unlink_github_issue",
        arguments: { ticketId },
      })
      const text = ((result as { content?: Array<{ text?: string }> }).content?.[0]?.text) ?? "{}"
      const parsed = JSON.parse(text) as { ok: boolean; unlinked: boolean }
      expect(parsed.ok).toBe(true)
      expect(parsed.unlinked).toBe(false)
    } finally {
      await client.close()
    }
  }, 30_000)
})
```

> The `withGithub: true` setup branch needs the actual `github_integrations` schema NOT NULL columns filled. Inspect `apps/dashboard/server/db/schema/github-integrations.ts` and the existing `github-sync.test.ts` setup helper to know what to insert. Phase 3 only USES this branch in one test (the link 409); if the GitHub-integration setup is too gnarly to mock, drop that test from this file and rely on real GitHub-connected dashboard tests for coverage.

- [ ] **Step 2: Run dev server, run test, stop server.**

```bash
MCP_ENABLED=true BETTER_AUTH_URL=http://localhost:3000 bun run dev > /tmp/dev.log 2>&1 &
DEV_PID=$!
for i in {1..30}; do
  if curl -sf http://localhost:3000/.well-known/oauth-authorization-server/api/auth > /dev/null 2>&1; then
    break
  fi
  sleep 1
done

MCP_ENABLED=true bun test apps/dashboard/tests/api/mcp-writes.test.ts

kill $DEV_PID 2>/dev/null
wait $DEV_PID 2>/dev/null
```

Expected: PASS — 4 tests (or 3 if the GitHub-integration test was dropped).

- [ ] **Step 3: Lint.** `bunx oxlint apps/dashboard/tests/api/mcp-writes.test.ts` — 0 errors.

- [ ] **Step 4: Commit.**

```bash
git add apps/dashboard/tests/api/mcp-writes.test.ts
git commit -m "test(mcp): integration tests for Phase 3 write tools"
```

---

## Self-Review

Looking over the plan against the spec's §5 (write tools), §7 (audit), and §8 (UI):

**Spec coverage:**

| Spec requirement | Plan task |
|---|---|
| `repro_update_ticket` (one tool, partial fields, atomic) | Task 5 |
| `repro_add_comment` | Task 5 |
| `repro_link_github_issue` | Task 5 (new functionality — service helper Task 4) |
| `repro_unlink_github_issue` | Task 5 (service helper Task 4) |
| `actor_client_id` audit column | Task 1 (migration) + threaded through Tasks 2, 3, 4, 5 |
| Reuse existing permissions (no new strings) | Tasks 2, 3, 4, 5 all use `requireProjectRoleByUser(..., "manager")` |
| `/settings/mcp` connect-an-AI snippets | Task 8 |
| `/settings/mcp` connected-apps + Disconnect | Tasks 7 + 8 |
| Single write surface (UI + MCP through same service) | Tasks 2, 3, 4 (service-function extraction) |

**Spec deviations (intentional):**
- **Severity dropped** — no `severity` column exists; adding it would be schema/UI/intake/sync work outside Phase 3 scope.
- **Assignees use full-replace `string[]`** (not `{ add, remove }`) — mirrors the existing `TriagePatchInput` shape so UI and MCP have one input vocabulary.
- **`repro_link_github_issue` is async-validated** — the link operation sets columns + enqueues a sync job; GitHub validation happens on the next reconciler tick. Matches the rest of the GitHub sync system.

**Spec items NOT in Phase 3 (deferred to Phase 4):**
- VitePress docs page.
- `MCP_ENABLED=true` flag flip.
- CHANGELOG migration note.

**Placeholder scan:** clean — every task has executable code, exact paths, exact commands, expected output. The Task 2/3/4 service-function bodies are described as "MOVE FROM existing endpoint" with explicit transformation rules; that's not a placeholder, it's a refactor instruction.

**Type consistency:** `McpRequestContext` (with `clientId: string`) used identically across Task 5's tools. `actorClientId` always typed `string | null`. `applyTicketTriagePatch`, `addReportComment`, `linkReportToGithubIssue`, `unlinkReportFromGithubIssue` all take `(tx, args)` with `args.actorClientId`.

**One inconsistency caught and fixed inline:** initial draft of the migration changed `report_events.actor_id text NOT NULL`. Reality: `actor_id` is already nullable (per schema readback in earlier exploration). The migration only adds `actor_client_id` — doesn't touch `actor_id`.

---

**Plan complete and saved to `docs/superpowers/plans/2026-05-07-mcp-oauth-server-phase-3.md`.**

9 tasks. Substantially refactor-heavy in the middle (Tasks 2-4 extract service functions from existing endpoints) but pays for itself: every write goes through one path. Estimated ~6 hours including verification.
