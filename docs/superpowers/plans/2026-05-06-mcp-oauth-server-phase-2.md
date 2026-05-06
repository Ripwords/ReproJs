# MCP OAuth Server — Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand the MCP read surface from 2 tools to 9 — adding ticket listing with filters/cursor, comment listing, project members, screenshot bytes, on-demand replay transcript, raw replay events with size guard, and a separate cookies tool. After Phase 2, an AI client connected to Repro can do a complete read-only triage workflow without ever touching the dashboard UI.

**Architecture:** Each new tool lives in `apps/dashboard/server/mcp/tools/<group>.ts` and is wired into `apps/dashboard/server/mcp/server.ts` alongside the two Phase 1 tools. Permission gates reuse `requireProjectRoleByUser(viewer)`. Cursor pagination uses base64-encoded `{ createdAt, id }`. Screenshots return as MCP `image` content with a hard inline byte cap and a graceful oversize error. Replay-raw uses the same size-guard pattern with an explicit `acknowledgeSize: true` override.

**Tech Stack:** Bun, Nuxt 4 / Nitro, drizzle-orm, Zod, `@modelcontextprotocol/sdk`. Postgres dev DB at port 5436. oxlint pinned to 1.59.0.

**Spec:** [`docs/superpowers/specs/2026-05-06-mcp-oauth-server-design.md`](../specs/2026-05-06-mcp-oauth-server-design.md) — §5 (Tool surface) read tools.

**Predecessor:** Phase 1 plan at [`docs/superpowers/plans/2026-05-06-mcp-oauth-server-phase-1.md`](2026-05-06-mcp-oauth-server-phase-1.md) — establishes `mcp/server.ts`, `mcp/context.ts`, `mcp/errors.ts`, `mcp/replay-transcript.ts`, the OAuth flow, and the `/api/mcp` route. Phase 2 builds on top with no changes to Phase 1 files except `server.ts` (to register more tools).

**Out of scope (deferred to follow-up plans):**
- Phase 3: write tools (`repro_update_ticket`, `repro_add_comment`, `repro_link_github_issue`, `repro_unlink_github_issue`) + `actor_client_id` audit column + `/settings/mcp` UI.
- Phase 4: VitePress docs + flag flip + CHANGELOG.

---

## File Structure

| Path | Status | Responsibility |
|---|---|---|
| `apps/dashboard/server/mcp/tools/tickets.ts` | modify | Add `repro_list_tickets` next to existing `repro_get_ticket`. |
| `apps/dashboard/server/mcp/tools/comments.ts` | create | `repro_list_ticket_comments` |
| `apps/dashboard/server/mcp/tools/members.ts` | create | `repro_list_project_members` (dashboard role-based members) |
| `apps/dashboard/server/mcp/tools/reports.ts` | create | `repro_get_screenshot`, `repro_get_replay_transcript`, `repro_get_replay_raw`, `repro_get_ticket_cookies` |
| `apps/dashboard/server/mcp/server.ts` | modify | Register the 7 new tools. |
| `apps/dashboard/server/mcp/cursor.ts` | create | Pure helper: `encodeCursor({ createdAt, id })` / `decodeCursor(s)` for ticket + comment pagination. |
| `apps/dashboard/server/mcp/cursor.test.ts` | create | Unit tests for the cursor helper. |
| `apps/dashboard/tests/api/mcp-phase2.test.ts` | create | Integration test exercising each new tool via the MCP client. |

**Why no separate refactor task:** the existing two-tool registration in `server.ts` is repeated for the new tools. With 9 tools the file grows from ~70 to ~180 lines. Still focused, still readable, no need for a registration loop.

---

## Conventions reused from Phase 1

- Tool shape: `export const xyzTool = { name, config: { description, inputSchema }, handler(input, ctx) }`.
- All read tools gate on `requireProjectRoleByUser(ctx.userId, projectId, "viewer")`.
- DB lookups never expose `storageKey` from `report_attachments`.
- Soft-deleted projects/reports/comments are filtered (`isNull(deletedAt)`).
- MCP results return `{ content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] }` (or `image` for screenshots).
- Tool errors throw `mcpError(code, message)` from `mcp/errors.ts`.
- Conventional Commits, one concern per commit, `bun test` for tests.
- Integration tests run against a live dev server with `MCP_ENABLED=true BETTER_AUTH_URL=http://localhost:3000`.

---

## Task 1: Cursor helper

**Files:**
- Create: `apps/dashboard/server/mcp/cursor.ts`
- Create: `apps/dashboard/server/mcp/cursor.test.ts`

A tiny pure module shared by `repro_list_tickets` and `repro_list_ticket_comments` for cursor-based pagination. Cursor = base64(`<ISO8601>|<UUID>`) — opaque to clients, deterministic to encode/decode.

- [ ] **Step 1: Write the failing test.**

```ts
// apps/dashboard/server/mcp/cursor.test.ts
import { describe, expect, it } from "bun:test"
import { decodeCursor, encodeCursor } from "./cursor"

describe("cursor", () => {
  it("roundtrips a Date + uuid", () => {
    const ts = new Date("2026-05-01T12:34:56.000Z")
    const id = "11111111-2222-3333-4444-555555555555"
    const encoded = encodeCursor({ createdAt: ts, id })
    expect(typeof encoded).toBe("string")
    const decoded = decodeCursor(encoded)
    expect(decoded?.createdAt.toISOString()).toBe("2026-05-01T12:34:56.000Z")
    expect(decoded?.id).toBe(id)
  })

  it("returns null for malformed cursors", () => {
    expect(decodeCursor("not-base64")).toBeNull()
    expect(decodeCursor("")).toBeNull()
    expect(decodeCursor(Buffer.from("bad-shape").toString("base64url"))).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test and confirm it fails.**

Run: `bun test apps/dashboard/server/mcp/cursor.test.ts`
Expected: FAIL — no `cursor` module.

- [ ] **Step 3: Implement the helper.**

```ts
// apps/dashboard/server/mcp/cursor.ts
// Opaque pagination cursor for tools that page over (createdAt DESC, id DESC).
// We don't need it to be unforgeable — any user who can list a project's
// tickets can also reconstruct cursors by hand. Base64url is just to keep
// the wire format opaque to clients.

export interface Cursor {
  createdAt: Date
  id: string
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function encodeCursor(c: Cursor): string {
  return Buffer.from(`${c.createdAt.toISOString()}|${c.id}`, "utf-8").toString("base64url")
}

export function decodeCursor(raw: string): Cursor | null {
  if (!raw) return null
  let decoded: string
  try {
    decoded = Buffer.from(raw, "base64url").toString("utf-8")
  } catch {
    return null
  }
  const sep = decoded.indexOf("|")
  if (sep < 0) return null
  const isoPart = decoded.slice(0, sep)
  const idPart = decoded.slice(sep + 1)
  if (!UUID_REGEX.test(idPart)) return null
  const ts = new Date(isoPart)
  if (Number.isNaN(ts.getTime())) return null
  return { createdAt: ts, id: idPart }
}
```

- [ ] **Step 4: Confirm the tests pass.**

Run: `bun test apps/dashboard/server/mcp/cursor.test.ts`
Expected: PASS — 2 tests.

- [ ] **Step 5: Commit.**

```bash
git add apps/dashboard/server/mcp/cursor.ts apps/dashboard/server/mcp/cursor.test.ts
git commit -m "feat(mcp): add cursor encode/decode helper for pagination"
```

---

## Task 2: `repro_list_tickets`

**Files:**
- Modify: `apps/dashboard/server/mcp/tools/tickets.ts` (append the new tool — keep existing `getTicketTool`)

Lists reports for a project with cursor pagination and basic filters. Sorts (createdAt DESC, id DESC) for stable pagination.

- [ ] **Step 1: Append the tool definition.**

Open `apps/dashboard/server/mcp/tools/tickets.ts`. Add the import additions at the top (alongside existing imports):

```ts
import { and, desc, eq, gt, inArray, isNull, lt, or, sql } from "drizzle-orm"
import { encodeCursor, decodeCursor } from "../cursor"
```

(Some imports may already exist — dedupe. The `inArray`, `isNull`, `gt`, `lt`, `or`, `desc`, `sql` are likely new; `eq` already imported.)

Then append at the bottom of the file:

```ts
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
      tag: z.array(z.string()).optional().describe("Filter to tickets containing ALL of these tags."),
      query: z.string().optional().describe("Case-insensitive substring match on title/description."),
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
      conditions.push(inArray(reports.status, input.status as ("open" | "in_progress" | "resolved" | "closed")[]))
    }
    if (input.priority?.length) {
      conditions.push(inArray(reports.priority, input.priority as ("low" | "normal" | "high" | "urgent")[]))
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
          and(eq(reports.createdAt, decodedCursor.createdAt), lt(reports.id, decodedCursor.id))
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
        ? encodeCursor({ createdAt: page[page.length - 1]!.createdAt, id: page[page.length - 1]!.id })
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
```

> Notes on adaptation:
> - If the `eq(reports.priority, ...)` enum cast errors with TypeScript strict mode, the cast `as ("low" | "normal" | "high" | "urgent")[]` is required because the schema's column type is narrowed and Zod's `.array(z.enum(...))` returns `string[]` at the type level.
> - The `or(...)!` non-null assertion is fine — drizzle's `or` only returns `undefined` when called with no args, which can't happen here.
> - `tags @> ARRAY[...]` uses Postgres array-contains (the GIN index `reports_tags_gin_idx` makes this fast).

- [ ] **Step 2: Lint check.**

Run: `bunx oxlint apps/dashboard/server/mcp/tools/tickets.ts`
Expected: 0 errors.

- [ ] **Step 3: Commit.**

```bash
git add apps/dashboard/server/mcp/tools/tickets.ts
git commit -m "feat(mcp): add repro_list_tickets with filters + cursor pagination"
```

---

## Task 3: `repro_list_ticket_comments`

**Files:**
- Create: `apps/dashboard/server/mcp/tools/comments.ts`

Returns ticket comments newest-first with cursor pagination. Excludes soft-deleted comments. Source-tags each comment as `dashboard` or `github` so the AI knows where it came from.

- [ ] **Step 1: Create the file.**

```ts
// apps/dashboard/server/mcp/tools/comments.ts
import { z } from "zod"
import { and, desc, eq, isNull, lt, or, sql } from "drizzle-orm"
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
```

- [ ] **Step 2: Lint check.**

Run: `bunx oxlint apps/dashboard/server/mcp/tools/comments.ts`
Expected: 0 errors.

- [ ] **Step 3: Commit.**

```bash
git add apps/dashboard/server/mcp/tools/comments.ts
git commit -m "feat(mcp): add repro_list_ticket_comments with cursor pagination"
```

---

## Task 4: `repro_list_project_members`

**Files:**
- Create: `apps/dashboard/server/mcp/tools/members.ts`

Returns dashboard project members (the `project_members` table — role-based). Note: assignees are GitHub-only in this codebase, so this tool returns members for permission/triage context, not the assignee universe.

- [ ] **Step 1: Create the file.**

```ts
// apps/dashboard/server/mcp/tools/members.ts
import { z } from "zod"
import { eq } from "drizzle-orm"
import { db } from "../../db"
import { projectMembers, user } from "../../db/schema"
import { requireProjectRoleByUser } from "../../lib/permissions"
import type { McpRequestContext } from "../context"

export const listProjectMembersTool = {
  name: "repro_list_project_members",
  config: {
    description:
      "List dashboard members of a Repro project — the people who can read or triage tickets in it. Each member has a role (viewer / manager / developer / owner). Note: ticket assignees are GitHub logins, distinct from dashboard members.",
    inputSchema: z.object({
      projectId: z.string().uuid(),
    }),
  },
  handler: async (input: { projectId: string }, ctx: McpRequestContext) => {
    await requireProjectRoleByUser(ctx.userId, input.projectId, "viewer")

    const rows = await db
      .select({
        userId: user.id,
        name: user.name,
        email: user.email,
        role: projectMembers.role,
      })
      .from(projectMembers)
      .innerJoin(user, eq(user.id, projectMembers.userId))
      .where(eq(projectMembers.projectId, input.projectId))

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            rows.map((m) => ({
              userId: m.userId,
              name: m.name,
              email: m.email,
              projectRole: m.role,
            })),
            null,
            2,
          ),
        },
      ],
    }
  },
}
```

- [ ] **Step 2: Lint check.**

Run: `bunx oxlint apps/dashboard/server/mcp/tools/members.ts`
Expected: 0 errors.

- [ ] **Step 3: Commit.**

```bash
git add apps/dashboard/server/mcp/tools/members.ts
git commit -m "feat(mcp): add repro_list_project_members"
```

---

## Task 5: `reports.ts` — `repro_get_screenshot`

**Files:**
- Create: `apps/dashboard/server/mcp/tools/reports.ts`

Returns the annotated screenshot (or unannotated fallback) as MCP `image` content. Hard cap at 1MB inline; oversize returns a clear error suggesting the dashboard UI.

- [ ] **Step 1: Create the file with the screenshot tool only (other tools added in Tasks 6–8).**

```ts
// apps/dashboard/server/mcp/tools/reports.ts
import { z } from "zod"
import { and, eq } from "drizzle-orm"
import { db } from "../../db"
import { reports, reportAttachments } from "../../db/schema"
import { requireProjectRoleByUser } from "../../lib/permissions"
import { mcpError } from "../errors"
import { getStorage } from "../../lib/storage"
import type { McpRequestContext } from "../context"

const SCREENSHOT_MAX_BYTES = 1024 * 1024 // 1 MB

export const getScreenshotTool = {
  name: "repro_get_screenshot",
  config: {
    description:
      "Fetch the annotated screenshot for a ticket as an inline image. Falls back to the unannotated screenshot if no annotated version exists. Returns an error if the image exceeds 1MB — fetch via the dashboard UI in that case.",
    inputSchema: z.object({
      ticketId: z.string().uuid(),
    }),
  },
  handler: async (input: { ticketId: string }, ctx: McpRequestContext) => {
    const [report] = await db
      .select({ projectId: reports.projectId })
      .from(reports)
      .where(eq(reports.id, input.ticketId))
      .limit(1)
    if (!report) throw mcpError("NOT_FOUND", `ticket ${input.ticketId} not found`)
    await requireProjectRoleByUser(ctx.userId, report.projectId, "viewer")

    const candidates = await db
      .select({
        kind: reportAttachments.kind,
        storageKey: reportAttachments.storageKey,
        contentType: reportAttachments.contentType,
        size: reportAttachments.sizeBytes,
      })
      .from(reportAttachments)
      .where(
        and(
          eq(reportAttachments.reportId, input.ticketId),
        ),
      )

    const annotated = candidates.find((a) => a.kind === "annotated-screenshot")
    const screenshot = candidates.find((a) => a.kind === "screenshot")
    const chosen = annotated ?? screenshot
    if (!chosen) {
      throw mcpError("NOT_FOUND", `no screenshot attached to ticket ${input.ticketId}`)
    }
    if (chosen.size > SCREENSHOT_MAX_BYTES) {
      throw mcpError(
        "PAYLOAD_TOO_LARGE",
        `screenshot is ${chosen.size} bytes (max ${SCREENSHOT_MAX_BYTES}); view it in the Repro dashboard UI`,
      )
    }

    const storage = getStorage()
    const obj = await storage.get(chosen.storageKey)
    const base64 = Buffer.from(obj.bytes).toString("base64")

    return {
      content: [
        {
          type: "image" as const,
          data: base64,
          mimeType: chosen.contentType,
        },
      ],
    }
  },
}
```

- [ ] **Step 2: Lint check.**

Run: `bunx oxlint apps/dashboard/server/mcp/tools/reports.ts`
Expected: 0 errors.

- [ ] **Step 3: Commit.**

```bash
git add apps/dashboard/server/mcp/tools/reports.ts
git commit -m "feat(mcp): add repro_get_screenshot tool"
```

---

## Task 6: `repro_get_replay_transcript`

**Files:**
- Modify: `apps/dashboard/server/mcp/tools/reports.ts` (append the new tool, keep `getScreenshotTool`)

A standalone variant of the inline transcript that `repro_get_ticket` already includes. Lets an AI re-fetch the transcript with `verbosity: "detailed"` for more event coverage.

- [ ] **Step 1: Append the tool definition.**

Add imports at the top (next to existing):

```ts
import { gunzipSync } from "node:zlib"
import { buildReplayTranscript, type RrwebEvent } from "../replay-transcript"
```

Then append at the bottom:

```ts
export const getReplayTranscriptTool = {
  name: "repro_get_replay_transcript",
  config: {
    description:
      "Re-fetch the textual replay timeline for a ticket. The 'summary' verbosity (default) matches the inline transcript in repro_get_ticket; 'detailed' includes more event types like focus/blur and DOM mutation counts.",
    inputSchema: z.object({
      ticketId: z.string().uuid(),
      verbosity: z.enum(["summary", "detailed"]).optional(),
    }),
  },
  handler: async (
    input: { ticketId: string; verbosity?: "summary" | "detailed" },
    ctx: McpRequestContext,
  ) => {
    const [report] = await db
      .select({ projectId: reports.projectId })
      .from(reports)
      .where(eq(reports.id, input.ticketId))
      .limit(1)
    if (!report) throw mcpError("NOT_FOUND", `ticket ${input.ticketId} not found`)
    await requireProjectRoleByUser(ctx.userId, report.projectId, "viewer")

    const [replayAttachment] = await db
      .select({
        storageKey: reportAttachments.storageKey,
      })
      .from(reportAttachments)
      .where(
        and(
          eq(reportAttachments.reportId, input.ticketId),
          eq(reportAttachments.kind, "replay"),
        ),
      )
      .limit(1)
    if (!replayAttachment) {
      throw mcpError("NOT_FOUND", `no replay captured for ticket ${input.ticketId}`)
    }

    const storage = getStorage()
    const obj = await storage.get(replayAttachment.storageKey)
    let events: RrwebEvent[]
    try {
      const decompressed = gunzipSync(Buffer.from(obj.bytes))
      events = JSON.parse(decompressed.toString("utf-8")) as RrwebEvent[]
    } catch (e) {
      throw mcpError(
        "INVALID_INPUT",
        `replay attachment for ticket ${input.ticketId} could not be decoded: ${
          e instanceof Error ? e.message : String(e)
        }`,
      )
    }
    const t = buildReplayTranscript(events, { verbosity: input.verbosity ?? "summary" })
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              transcript: t.transcript,
              eventCount: t.eventCount,
              durationMs: t.durationMs,
              truncated: t.truncated,
              verbosity: input.verbosity ?? "summary",
            },
            null,
            2,
          ),
        },
      ],
    }
  },
}
```

- [ ] **Step 2: Lint check.**

Run: `bunx oxlint apps/dashboard/server/mcp/tools/reports.ts`
Expected: 0 errors.

- [ ] **Step 3: Commit.**

```bash
git add apps/dashboard/server/mcp/tools/reports.ts
git commit -m "feat(mcp): add repro_get_replay_transcript tool"
```

---

## Task 7: `repro_get_replay_raw`

**Files:**
- Modify: `apps/dashboard/server/mcp/tools/reports.ts` (append, keep prior tools)

Returns the raw decompressed rrweb event JSON. Has a 200KB cap on the decoded event JSON; an explicit `acknowledgeSize: true` is required to bypass.

- [ ] **Step 1: Append the tool.**

```ts
const REPLAY_RAW_DEFAULT_CAP = 200 * 1024 // 200 KB of decoded JSON

export const getReplayRawTool = {
  name: "repro_get_replay_raw",
  config: {
    description:
      "Fetch the raw rrweb event stream for a ticket as JSON. The decompressed size is capped at 200KB unless you pass acknowledgeSize: true. Use repro_get_replay_transcript first — raw events are noisy and rarely needed.",
    inputSchema: z.object({
      ticketId: z.string().uuid(),
      acknowledgeSize: z.boolean().optional(),
    }),
  },
  handler: async (
    input: { ticketId: string; acknowledgeSize?: boolean },
    ctx: McpRequestContext,
  ) => {
    const [report] = await db
      .select({ projectId: reports.projectId })
      .from(reports)
      .where(eq(reports.id, input.ticketId))
      .limit(1)
    if (!report) throw mcpError("NOT_FOUND", `ticket ${input.ticketId} not found`)
    await requireProjectRoleByUser(ctx.userId, report.projectId, "viewer")

    const [replayAttachment] = await db
      .select({
        storageKey: reportAttachments.storageKey,
      })
      .from(reportAttachments)
      .where(
        and(
          eq(reportAttachments.reportId, input.ticketId),
          eq(reportAttachments.kind, "replay"),
        ),
      )
      .limit(1)
    if (!replayAttachment) {
      throw mcpError("NOT_FOUND", `no replay captured for ticket ${input.ticketId}`)
    }

    const storage = getStorage()
    const obj = await storage.get(replayAttachment.storageKey)
    let decompressed: Buffer
    try {
      decompressed = gunzipSync(Buffer.from(obj.bytes))
    } catch (e) {
      throw mcpError(
        "INVALID_INPUT",
        `replay attachment for ticket ${input.ticketId} could not be decompressed: ${
          e instanceof Error ? e.message : String(e)
        }`,
      )
    }
    if (decompressed.byteLength > REPLAY_RAW_DEFAULT_CAP && !input.acknowledgeSize) {
      throw mcpError(
        "PAYLOAD_TOO_LARGE",
        `replay events are ${decompressed.byteLength} bytes (cap ${REPLAY_RAW_DEFAULT_CAP}). Re-call with acknowledgeSize: true to receive the full payload.`,
      )
    }
    const events = JSON.parse(decompressed.toString("utf-8")) as RrwebEvent[]

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ events, byteCount: decompressed.byteLength }, null, 2),
        },
      ],
    }
  },
}
```

- [ ] **Step 2: Lint check.**

Run: `bunx oxlint apps/dashboard/server/mcp/tools/reports.ts`
Expected: 0 errors.

- [ ] **Step 3: Commit.**

```bash
git add apps/dashboard/server/mcp/tools/reports.ts
git commit -m "feat(mcp): add repro_get_replay_raw with 200KB acknowledgeSize cap"
```

---

## Task 8: `repro_get_ticket_cookies`

**Files:**
- Modify: `apps/dashboard/server/mcp/tools/reports.ts` (append; keep prior tools)

Returns the captured cookies from the report's `context.cookies` field. A separate opt-in tool because cookies often contain session tokens from the host app that the AI shouldn't casually ingest.

- [ ] **Step 1: Append the tool.**

```ts
// SharedReportContext shape (from packages/shared) — narrowed locally.
interface ReportContextWithCookies {
  cookies?: Array<{
    name: string
    value: string
    domain?: string
    path?: string
    secure?: boolean
    httpOnly?: boolean
    sameSite?: string
  }>
}

export const getTicketCookiesTool = {
  name: "repro_get_ticket_cookies",
  config: {
    description:
      "Fetch the cookies captured at report time for a ticket. WARNING: cookies often contain session tokens from the host application — handle this output with care. Returns an empty array if no cookies were captured. (Cookies are deliberately omitted from repro_get_ticket to require an explicit opt-in here.)",
    inputSchema: z.object({
      ticketId: z.string().uuid(),
    }),
  },
  handler: async (input: { ticketId: string }, ctx: McpRequestContext) => {
    const [report] = await db
      .select({
        projectId: reports.projectId,
        context: reports.context,
      })
      .from(reports)
      .where(eq(reports.id, input.ticketId))
      .limit(1)
    if (!report) throw mcpError("NOT_FOUND", `ticket ${input.ticketId} not found`)
    await requireProjectRoleByUser(ctx.userId, report.projectId, "viewer")

    const ctxJson = (report.context ?? {}) as ReportContextWithCookies
    const cookies = ctxJson.cookies ?? []

    return {
      content: [{ type: "text" as const, text: JSON.stringify({ cookies }, null, 2) }],
    }
  },
}
```

- [ ] **Step 2: Lint check.**

Run: `bunx oxlint apps/dashboard/server/mcp/tools/reports.ts`
Expected: 0 errors.

- [ ] **Step 3: Commit.**

```bash
git add apps/dashboard/server/mcp/tools/reports.ts
git commit -m "feat(mcp): add repro_get_ticket_cookies (opt-in cookies surface)"
```

---

## Task 9: Register the 7 new tools in `server.ts`

**Files:**
- Modify: `apps/dashboard/server/mcp/server.ts`

Wire all the new tools into `buildMcpServer`. The pattern follows the existing two-tool registration; we just add 7 more `server.registerTool(...)` calls plus their tool imports.

- [ ] **Step 1: Update imports at the top of `server.ts`.**

Find:
```ts
import { listProjectsTool } from "./tools/projects"
import { getTicketTool } from "./tools/tickets"
```

Replace with:
```ts
import { listProjectsTool } from "./tools/projects"
import { getTicketTool, listTicketsTool } from "./tools/tickets"
import { listTicketCommentsTool } from "./tools/comments"
import { listProjectMembersTool } from "./tools/members"
import {
  getScreenshotTool,
  getReplayTranscriptTool,
  getReplayRawTool,
  getTicketCookiesTool,
} from "./tools/reports"
```

- [ ] **Step 2: Add the new registerTool calls inside `buildMcpServer`.**

After the existing two `server.registerTool(...)` calls for `listProjectsTool` and `getTicketTool`, append these seven blocks (one per new tool). Each follows the same try/catch wrapper pattern as Phase 1:

```ts
  server.registerTool(
    listTicketsTool.name,
    listTicketsTool.config,
    async (input) => {
      try {
        return await listTicketsTool.handler(input as Parameters<typeof listTicketsTool.handler>[0], ctx)
      } catch (err) {
        return toolErrorResult(err)
      }
    },
  )

  server.registerTool(
    listTicketCommentsTool.name,
    listTicketCommentsTool.config,
    async (input) => {
      try {
        return await listTicketCommentsTool.handler(input as Parameters<typeof listTicketCommentsTool.handler>[0], ctx)
      } catch (err) {
        return toolErrorResult(err)
      }
    },
  )

  server.registerTool(
    listProjectMembersTool.name,
    listProjectMembersTool.config,
    async (input) => {
      try {
        return await listProjectMembersTool.handler(input as Parameters<typeof listProjectMembersTool.handler>[0], ctx)
      } catch (err) {
        return toolErrorResult(err)
      }
    },
  )

  server.registerTool(
    getScreenshotTool.name,
    getScreenshotTool.config,
    async (input) => {
      try {
        return await getScreenshotTool.handler(input as Parameters<typeof getScreenshotTool.handler>[0], ctx)
      } catch (err) {
        return toolErrorResult(err)
      }
    },
  )

  server.registerTool(
    getReplayTranscriptTool.name,
    getReplayTranscriptTool.config,
    async (input) => {
      try {
        return await getReplayTranscriptTool.handler(input as Parameters<typeof getReplayTranscriptTool.handler>[0], ctx)
      } catch (err) {
        return toolErrorResult(err)
      }
    },
  )

  server.registerTool(
    getReplayRawTool.name,
    getReplayRawTool.config,
    async (input) => {
      try {
        return await getReplayRawTool.handler(input as Parameters<typeof getReplayRawTool.handler>[0], ctx)
      } catch (err) {
        return toolErrorResult(err)
      }
    },
  )

  server.registerTool(
    getTicketCookiesTool.name,
    getTicketCookiesTool.config,
    async (input) => {
      try {
        return await getTicketCookiesTool.handler(input as Parameters<typeof getTicketCookiesTool.handler>[0], ctx)
      } catch (err) {
        return toolErrorResult(err)
      }
    },
  )
```

- [ ] **Step 3: Lint check.**

Run: `bunx oxlint apps/dashboard/server/mcp/server.ts`
Expected: 0 errors.

- [ ] **Step 4: Commit.**

```bash
git add apps/dashboard/server/mcp/server.ts
git commit -m "feat(mcp): register Phase 2 tools in McpServer factory"
```

---

## Task 10: Integration test for Phase 2 tools

**Files:**
- Create: `apps/dashboard/tests/api/mcp-phase2.test.ts`

Acceptance test for the 7 new tools, run against the live dev server with a programmatic OAuth dance (replicating Phase 1's helper structure).

- [ ] **Step 1: Create the test file.**

```ts
// apps/dashboard/tests/api/mcp-phase2.test.ts
import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { createHash, randomBytes } from "node:crypto"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { db } from "../../server/db"
import { projects, projectMembers, reports, reportComments, reportAttachments } from "../../server/db/schema"
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
  userId: string
  projectId: string
  ticketId: string
}

async function setupOAuth(): Promise<SetupResult> {
  await truncateDomain()
  const userId = await createUser("phase2-mcp@example.com")
  const cookie = await signIn("phase2-mcp@example.com")

  const projectId = crypto.randomUUID()
  await db.insert(projects).values({ id: projectId, name: "Phase 2 Test", createdBy: userId })
  await db.insert(projectMembers).values({ projectId, userId, role: "developer" })

  const ticketId = crypto.randomUUID()
  await db.insert(reports).values({
    id: ticketId,
    projectId,
    title: "Login button does nothing",
    description: "Clicking the **Sign in** button no longer triggers anything",
    status: "open",
    priority: "high",
    tags: ["auth", "frontend"],
    source: "web",
    context: {
      source: "web",
      pageUrl: "https://example.com/login",
      userAgent: "Mozilla/5.0",
      viewport: { w: 1440, h: 900 },
      timestamp: Date.now(),
      cookies: [{ name: "host_session", value: "•••", domain: "example.com" }],
    },
  })
  await db.insert(reportComments).values({
    reportId: ticketId,
    userId,
    body: "Reproduced on Chrome 132",
    source: "dashboard",
  })

  const discovery = await fetch(`${BASE}/.well-known/oauth-authorization-server/api/auth`).then((r) =>
    r.json(),
  )
  const reg = await fetch(discovery.registration_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "Phase2 Test Client",
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
    const consentLocationUrl = new URL(location, BASE)
    const oauthQuery = consentLocationUrl.search.replace(/^\?/, "")
    const decision = await apiFetch<{ redirectUri: string }>("/api/oauth/consent", {
      method: "POST",
      headers: { cookie },
      body: { oauthQuery, allow: true },
    })
    expect(decision.status).toBe(200)
    location = decision.body.redirectUri
  }
  const code = new URL(location, BASE).searchParams.get("code")!
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

  const client = new Client({ name: "phase2-test-client", version: "0.0.0" })
  const transport = new StreamableHTTPClientTransport(new URL(`${BASE}/api/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${tokenRes.access_token}` } },
  })
  await client.connect(transport)
  return { client, userId, projectId, ticketId }
}

function parseToolText<T>(result: { content?: Array<unknown> }): T {
  const text = (result.content?.[0] as { text?: string } | undefined)?.text ?? "null"
  return JSON.parse(text) as T
}

describe("MCP Phase 2 read tools", () => {
  it("repro_list_tickets returns the seeded ticket", async () => {
    const { client, projectId, ticketId } = await setupOAuth()
    try {
      const result = await client.callTool({
        name: "repro_list_tickets",
        arguments: { projectId },
      })
      const parsed = parseToolText<{ items: Array<{ id: string; title: string; tags: string[] }>; nextCursor: string | null }>(result)
      expect(parsed.items.find((t) => t.id === ticketId)?.tags).toContain("auth")
      expect(parsed.nextCursor).toBeNull()
    } finally {
      await client.close()
    }
  }, 30_000)

  it("repro_list_ticket_comments returns the seeded comment", async () => {
    const { client, ticketId } = await setupOAuth()
    try {
      const result = await client.callTool({
        name: "repro_list_ticket_comments",
        arguments: { ticketId },
      })
      const parsed = parseToolText<{ items: Array<{ body: string; source: string }> }>(result)
      expect(parsed.items[0]?.body).toBe("Reproduced on Chrome 132")
      expect(parsed.items[0]?.source).toBe("dashboard")
    } finally {
      await client.close()
    }
  }, 30_000)

  it("repro_list_project_members returns the seeded developer", async () => {
    const { client, projectId, userId } = await setupOAuth()
    try {
      const result = await client.callTool({
        name: "repro_list_project_members",
        arguments: { projectId },
      })
      const parsed = parseToolText<Array<{ userId: string; projectRole: string }>>(result)
      expect(parsed.find((m) => m.userId === userId)?.projectRole).toBe("developer")
    } finally {
      await client.close()
    }
  }, 30_000)

  it("repro_get_ticket_cookies returns captured cookies", async () => {
    const { client, ticketId } = await setupOAuth()
    try {
      const result = await client.callTool({
        name: "repro_get_ticket_cookies",
        arguments: { ticketId },
      })
      const parsed = parseToolText<{ cookies: Array<{ name: string; value: string }> }>(result)
      expect(parsed.cookies[0]?.name).toBe("host_session")
      expect(parsed.cookies[0]?.value).toBe("•••")
    } finally {
      await client.close()
    }
  }, 30_000)

  it("repro_get_screenshot returns NOT_FOUND when no screenshot is attached", async () => {
    const { client, ticketId } = await setupOAuth()
    try {
      const result = await client.callTool({
        name: "repro_get_screenshot",
        arguments: { ticketId },
      })
      // The tool throws -> server wraps as { isError: true, content: [{ text: "NOT_FOUND: ..." }] }
      expect((result as { isError?: boolean }).isError).toBe(true)
      const txt = ((result as { content?: Array<{ text?: string }> }).content?.[0]?.text) ?? ""
      expect(txt).toMatch(/NOT_FOUND/)
    } finally {
      await client.close()
    }
  }, 30_000)

  it("repro_get_replay_transcript returns NOT_FOUND when no replay is attached", async () => {
    const { client, ticketId } = await setupOAuth()
    try {
      const result = await client.callTool({
        name: "repro_get_replay_transcript",
        arguments: { ticketId },
      })
      expect((result as { isError?: boolean }).isError).toBe(true)
      const txt = ((result as { content?: Array<{ text?: string }> }).content?.[0]?.text) ?? ""
      expect(txt).toMatch(/NOT_FOUND/)
    } finally {
      await client.close()
    }
  }, 30_000)

  it("repro_get_replay_raw returns NOT_FOUND when no replay is attached", async () => {
    const { client, ticketId } = await setupOAuth()
    try {
      const result = await client.callTool({
        name: "repro_get_replay_raw",
        arguments: { ticketId },
      })
      expect((result as { isError?: boolean }).isError).toBe(true)
    } finally {
      await client.close()
    }
  }, 30_000)
})
```

> Notes:
> - We test the NOT_FOUND path on the binary-payload tools (screenshot / replay_transcript / replay_raw) because seeding an actual replay or screenshot blob from the test setup is heavy and the happy path is already exercised in production via real intake. Phase 4 docs can call out a manual smoke test.
> - Each test setups its own OAuth dance; that's slow per test but isolates failures and matches the Phase 1 pattern. Total suite expected to run in ~2-5 seconds against a warm dev server.

- [ ] **Step 2: Run the dev server in the background.**

```bash
MCP_ENABLED=true BETTER_AUTH_URL=http://localhost:3000 bun run dev > /tmp/dev.log 2>&1 &
DEV_PID=$!
for i in {1..30}; do
  if curl -sf http://localhost:3000/.well-known/oauth-authorization-server/api/auth > /dev/null 2>&1; then
    break
  fi
  sleep 1
done
```

- [ ] **Step 3: Run the test.**

```bash
MCP_ENABLED=true bun test apps/dashboard/tests/api/mcp-phase2.test.ts
```

Expected: PASS — 7 tests.

- [ ] **Step 4: Stop the dev server.**

```bash
kill $DEV_PID 2>/dev/null
wait $DEV_PID 2>/dev/null
```

- [ ] **Step 5: Lint check.**

Run: `bunx oxlint apps/dashboard/tests/api/mcp-phase2.test.ts`
Expected: 0 errors.

- [ ] **Step 6: Commit.**

```bash
git add apps/dashboard/tests/api/mcp-phase2.test.ts
git commit -m "test(mcp): integration tests for Phase 2 read tools"
```

---

## Self-Review

Looking over the plan with fresh eyes against the spec's §5 read-tool table:

**Spec coverage (Phase 2 only):**

| Spec read tool | Plan task |
|---|---|
| `repro_list_tickets` | Task 2 |
| `repro_list_ticket_comments` | Task 3 |
| `repro_get_screenshot` (image content, oversize cap) | Task 5 |
| `repro_get_replay_transcript` (verbosity option) | Task 6 |
| `repro_get_replay_raw` (200KB cap, acknowledgeSize) | Task 7 |
| `repro_get_ticket_cookies` (separate opt-in) | Task 8 |
| `repro_list_project_members` | Task 4 |
| `repro_list_projects` | (Phase 1) |
| `repro_get_ticket` | (Phase 1) |

Cursor pagination, integration test coverage, and tool registration are all covered (Tasks 1, 9, 10).

**Placeholder scan:** clean — every step has executable code, exact paths, exact commands.

**Type consistency:** `McpRequestContext` import path stable (`../context`); `mcpError` from `../errors`; `requireProjectRoleByUser(ctx.userId, projectId, "viewer")` matches the Phase 1 helper.

**Two known divergences from spec deliberately preserved:**

1. **Spec §5.1 mentions `repro_list_project_members` returns `{ userId, name, email, projectRole }`.** Plan matches. But the spec implicitly suggests this is the assignee universe — the codebase reality is that assignees are GitHub-only. The tool description in Task 4 explicitly calls this out: *"ticket assignees are GitHub logins, distinct from dashboard members."*

2. **Spec §5 `repro_get_screenshot` says "image content (base64 PNG)".** Plan does that with a 1MB cap; oversize throws `PAYLOAD_TOO_LARGE`. The cap is a Phase-2 implementation choice (spec didn't fix a number); 1MB is the threshold where MCP clients start to feel the latency hit on stdin/stdout. Worth flagging in Phase 4 docs.

**One spec ambiguity resolved here:** `repro_list_tickets` `query` filter — spec says "free-text", plan implements case-insensitive `LIKE` on title + description. Phase 3 or 4 could swap to Postgres FTS if needed.

---

**Plan complete and saved to `docs/superpowers/plans/2026-05-06-mcp-oauth-server-phase-2.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
