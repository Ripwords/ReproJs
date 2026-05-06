# MCP OAuth Server — Design

**Status:** Draft (brainstormed 2026-05-06)
**Owner:** JJ
**Related:** `2026-04-18-session-replay-design.md`, `2026-04-18-github-sync-design.md`, `2026-04-21-admin-overview-and-manager-role-design.md`

## 1. Goal

Make Repro AI-native by exposing tickets and full report context (annotated screenshot, console + network logs, system info, session replay) to AI assistants (Claude Desktop, Cursor, ChatGPT, etc.) via the Model Context Protocol. Auth is per-user OAuth — an AI client connects "as" a Repro user, sees what that user sees, and can perform the same triage operations they could perform in the dashboard UI. No new auth surface, no service tokens, no new permission strings.

## 2. Decisions (resolved during brainstorming)

| Decision | Choice |
|---|---|
| Who is the MCP client? | Per-user, scoped to projects the user already belongs to |
| Capabilities | Read + safe writes (status, priority, severity, assignee, tags, comments, GitHub link/unlink). No deletes, no integration mutations, no ticket creation. |
| OAuth consent granularity | Account-wide. Single `mcp:full` scope. Per-project scoping deferred. |
| Replay payload shape | Transcript inline in `repro_get_ticket` (cheap, AI-readable). Raw rrweb events available via separate `repro_get_replay_raw` tool with size guard. |
| Better-auth plugin | `oauth-provider` (the deprecated `mcp` plugin is being replaced by it; `oauth-provider` has first-class MCP support including RFC 8414 discovery, RFC 7591 dynamic client registration, and an `mcpHandler` helper). |
| Architecture | All inside Nitro. Streamable HTTP transport. `mcpHandler` from better-auth wraps protocol + JWT verification; tool definitions live in `server/mcp/tools/*.ts`. |

## 3. Architecture

```
AI client (Claude Desktop, Cursor, ChatGPT, mcp-remote)
        │
        │ 1. GET /.well-known/oauth-authorization-server  (RFC 8414)
        │ 2. POST /oauth2/register                        (RFC 7591)
        │ 3. Browser → /oauth2/authorize  → /sign-in (existing)
        │                                 → /oauth/consent (new)
        │ 4. POST /oauth2/token   (PKCE)
        │
        │ 5. MCP over Streamable HTTP
        ▼
POST /api/mcp   (Authorization: Bearer <jwt>)
        │
        │ mcpHandler(server, { resourceServerOptions })
        │   • verifies JWT (audience-bound)
        │   • dispatches MCP request to Server instance
        │
        ▼
MCP Server  (server/mcp/server.ts)
  • tools registered from server/mcp/tools/*.ts
  • each handler receives { userId, clientId, params }
  • handlers reuse existing service layer:
      - db (drizzle)
      - permissions.ts (assertProjectRole, etc.)
      - github-cache.ts
      - storage adapter (signed-attachment-url.ts)
        │
        ▼
Tool result (JSON; image content for screenshots; replay
transcript text inline by default)
```

### Boundaries (file-by-file)

| Path | Responsibility |
|---|---|
| `apps/dashboard/server/lib/auth.ts` | Add `oauthProvider({ ... })` to `plugins`. Only auth change. |
| `apps/dashboard/server/api/mcp.ts` (`.post.ts` + `.get.ts`) | Single Nitro route, ~30 lines, delegates to `mcpHandler`. |
| `apps/dashboard/server/mcp/server.ts` | Constructs `Server` from `@modelcontextprotocol/sdk`, registers all tools. |
| `apps/dashboard/server/mcp/context.ts` | Extracts `{ userId, clientId }` from `mcpHandler` request context. Builds per-request services bundle. |
| `apps/dashboard/server/mcp/tools/projects.ts` | `repro_list_projects` |
| `apps/dashboard/server/mcp/tools/tickets.ts` | `repro_list_tickets`, `repro_get_ticket`, `repro_update_ticket` |
| `apps/dashboard/server/mcp/tools/comments.ts` | `repro_list_ticket_comments`, `repro_add_comment` |
| `apps/dashboard/server/mcp/tools/reports.ts` | `repro_get_screenshot`, `repro_get_replay_transcript`, `repro_get_replay_raw`, `repro_get_ticket_cookies` |
| `apps/dashboard/server/mcp/tools/members.ts` | `repro_list_project_members` |
| `apps/dashboard/server/mcp/tools/github.ts` | `repro_link_github_issue`, `repro_unlink_github_issue` |
| `apps/dashboard/server/mcp/replay-transcript.ts` | Pure rrweb-events → text timeline reducer. |
| `apps/dashboard/server/mcp/__fixtures__/*.json` | Golden replay fixtures for tests. |
| `apps/dashboard/app/pages/oauth/consent.vue` | OAuth consent page (~80 lines). |
| `apps/dashboard/app/pages/settings/mcp.vue` | Connect-an-AI page + connected-apps list. |

### What we are NOT building (deliberate)

- No new database for MCP. `oauth-provider` brings its own schema (clients, codes, tokens, consents) generated through `auth:gen`.
- No project-scoping on tokens. Single `mcp:full` scope authorizes everything the user can already do.
- No MCP push notifications / `list_changed` events. Tools are polled.
- No write surface beyond ticket triage. No `delete_*`, no integration config mutation, no member/role mutation.
- No `ticket://` resources. Tools-only for v1.

## 4. OAuth flow

### Plugin configuration (`server/lib/auth.ts`)

```ts
import { oauthProvider } from "better-auth/plugins/oauth-provider"

plugins: [
  magicLink({ /* existing */ }),
  oauthProvider({
    loginPage: "/sign-in",
    consentPage: "/oauth/consent",
    allowDynamicClientRegistration: true,
    requirePkce: true,
    accessTokenTtl: env.MCP_ACCESS_TOKEN_TTL_SECONDS,   // default 3600
    refreshTokenTtl: 60 * 60 * 24 * 30,
    rotateRefreshTokens: true,
    scopes: {
      "mcp:full": "Read and triage your Repro tickets and reports",
    },
  }),
],
```

### Step-by-step

1. **Discovery.** AI client fetches `https://<dashboard>/.well-known/oauth-authorization-server`. Provided automatically by `oauth-provider`. Returns issuer, authorize/token/register endpoint URLs, supported PKCE methods, supported scopes.
2. **Dynamic registration.** Client `POST /oauth2/register` with `{ client_name, redirect_uris, token_endpoint_auth_method: "none" }`. Returns `client_id`. Anonymous registration is intentional — this only registers an OAuth *client*, not a grant.
3. **Authorize.** Client opens `/oauth2/authorize?...` in browser. If no session, better-auth redirects to existing `/sign-in` flow. On return:
   - First `(user, client_id)` pair → `/oauth/consent` renders.
   - Repeat → silent grant.
4. **Token exchange.** Client posts `code + code_verifier` to `/oauth2/token`. Returns JWT access token + opaque refresh token. JWT claims: `sub` (user id), `aud` (dashboard MCP resource URI), `scope`, `client_id`, `exp`.
5. **MCP requests.** All `/api/mcp` requests carry `Authorization: Bearer <jwt>`. `mcpHandler` verifies and exposes user context.
6. **Refresh.** Standard refresh flow at `/oauth2/token`. Refresh re-runs `isEmailDomainAllowed` so domain-allowlist tightening kills access on next refresh (within 1h).
7. **Revoke.** `/settings/mcp` "Disconnect" deletes consent + active tokens.

### Consent page (`/oauth/consent`)

Vue page (~80 lines). Renders client name, scope description bullets (read tickets, change status/priority/assignee/tags, post comments, link GitHub issues), Allow/Deny buttons posting to `oauth-provider`'s decision endpoint, and a "You can revoke anytime in Settings → Connected apps" line.

### Rate limits

- `/oauth2/token` and `/oauth2/authorize` reuse the existing `strictAuthRule` (5 / 15min / IP).
- `/api/mcp` gets a separate per-user limit, default `MCP_RATE_LIMIT_PER_USER_PER_MINUTE=600`. AI clients are chatty.

### Interaction with existing constraints

- `app_settings.allowedEmailDomains` gate runs at sign-in (unchanged) and on refresh-token use (new). MCP cannot bypass it.
- Existing GitHub OAuth (where Repro is a *client* of GitHub) and the new `oauth-provider` (where Repro is the *AS*) coexist without conflict.
- `BETTER_AUTH_SECRET` is reused for JWT signing. No new auth secrets.

## 5. Tool surface

Naming: `repro_<verb>_<noun>` — sorts together in client UI, no collision with other servers.

### Read tools

| Tool | Params | Returns |
|---|---|---|
| `repro_list_projects` | (none) | `[{ id, slug, name, role }]` |
| `repro_list_tickets` | `projectId`, `status[]?`, `priority[]?`, `severity[]?`, `assigneeId?`, `tag[]?`, `query?`, `cursor?`, `limit?` (≤50) | `{ items: TicketSummary[], nextCursor }` |
| `repro_get_ticket` | `ticketId` | `TicketDetail` (see §5.1) |
| `repro_list_ticket_comments` | `ticketId`, `cursor?`, `limit?` (≤50) | `{ items: Comment[], nextCursor }` |
| `repro_get_screenshot` | `ticketId`, `attachmentId?` | MCP `image` content (base64 PNG) |
| `repro_get_replay_transcript` | `ticketId`, `verbosity?: "summary" \| "detailed"` (default `summary`) | `{ transcript, eventCount, durationMs, truncated }` |
| `repro_get_replay_raw` | `ticketId`, `acknowledgeSize?: boolean` | `{ events, schemaVersion }`. Returns 413 if events > 200KB and `acknowledgeSize` is not `true`. |
| `repro_get_ticket_cookies` | `ticketId` | `[{ name, value, domain, path, secure, httpOnly?, sameSite? }]`. Separate opt-in tool — AI must explicitly request. |
| `repro_list_project_members` | `projectId` | `[{ userId, name, email, projectRole }]` |

### Write tools

| Tool | Params | Permission |
|---|---|---|
| `repro_update_ticket` | `ticketId`, partial `{ status?, priority?, severity?, assigneeId?, tags?: { add?, remove? } }` | `tickets.update` (developer+) |
| `repro_add_comment` | `ticketId`, `body` (markdown), `private?: boolean` (default `false`) | `tickets.comment` |
| `repro_link_github_issue` | `ticketId`, `repoOwner`, `repoName`, `issueNumber` | `integrations.link` |
| `repro_unlink_github_issue` | `ticketId` | `integrations.link` |

`repro_update_ticket` is one tool with optional fields, not five. AIs handle "set status to in-progress and assign to alice" as a single atomic call.

### 5.1 `TicketDetail` schema

```ts
{
  id: string
  projectId: string
  title: string
  description: string                    // markdown
  status: "open" | "in_progress" | "resolved" | "closed"
  priority: "low" | "medium" | "high" | "urgent"
  severity: "low" | "medium" | "high" | "critical"
  assignee: { userId, name, email } | null
  reporter: { name?, email?, identifiedUserId? }
  tags: string[]
  createdAt: string                      // ISO 8601
  updatedAt: string
  github: {                              // null if not linked
    repoOwner, repoName, issueNumber,
    issueState: "open" | "closed",       // from github-cache, may be stale
    issueUrl,
  } | null
  pageContext: { url, referrer, title }
  systemInfo: {
    userAgent, os, browser, browserVersion,
    viewport: { w, h }, dpr, language, timezone,
  }
  attachments: [{ id, kind: "screenshot" | "replay" | "other", url, contentType, size }]
  consoleLog: ConsoleEntry[]             // already textual, capped at intake
  networkLog: NetworkEntry[]             // already textual, capped at intake
  replay: {                              // included inline by default
    durationMs, eventCount,
    transcript: string,                  // see §6
  } | null
  customMetadata: Record<string, unknown>
}
```

Cookies are deliberately omitted from `TicketDetail` and only returned by the separate opt-in `repro_get_ticket_cookies` tool to reduce accidental leakage.

Typical payload size ≪ 100KB given existing intake-time caps on console/network logs and the transcript reducer's 4KB cap.

## 6. Replay transcript reducer

**Module:** `apps/dashboard/server/mcp/replay-transcript.ts`. Pure function, no DB or network access.

```ts
export function buildReplayTranscript(
  events: RrwebEvent[],
  opts: { verbosity: "summary" | "detailed"; maxBytes?: number },
): {
  transcript: string
  eventCount: number
  durationMs: number
  truncated: boolean
}
```

### Inclusion policy

| Source | Summary | Detailed | Notes |
|---|---|---|---|
| Meta — navigation / URL change | ✅ | ✅ | Anchors the timeline |
| MouseInteraction — click, dblclick, contextmenu | ✅ | ✅ | Resolved to selector + nearest text |
| Input changes | ✅ (coalesced) | ✅ (coalesced) | Per-field final value; masked stays masked |
| Console errors | ✅ | ✅ | |
| ViewportResize | first + last | all | |
| MouseMove, Scroll, Selection | ❌ | summarized count | "scrolled 14 times" |
| Mutation | ❌ | summarized count | DOM mutation count |
| MouseInteraction — focus / blur | ❌ | ✅ | |
| StyleSheet / Canvas / Font / Drag / Media | ❌ | ❌ | Never useful textually |

### Selector resolution

Reducer walks the **FullSnapshot** at the start of the stream to build `Map<id, NodeMeta>`. Applies subsequent **Mutation** events to keep the map current. Resolution priority for interaction targets: `tag[name|aria-label|text]` > `tag.classname` > `tag:contains("...")` (truncated text) > `<tagname>` fallback. If the stream lacks a FullSnapshot the reducer emits `<unknown element ${id}>` and continues — defensive, not normal.

### Coalescing typing

Buffers consecutive `Input` events on the same target id. Flushes on focus change, 1.5s of inactivity, or navigation. Emits `typed "{final value}" into {selector}`. Masked values come through as `"•••"` from the recorder and are **never unmasked** by the reducer.

### Size cap & truncation

Default `maxBytes`: 4KB summary, 16KB detailed. Over the cap: keep all errors + navigations + clicks; drop scroll/resize/focus/blur first; coalesce more aggressively; if still over, truncate from the middle (keep first and last 30%) with `… (N events omitted) …`. Sets `truncated: true`.

### Schema versioning

Reads the `replaySchemaVersion` field from the stream (per `2026-04-18-session-replay-design.md`). Unknown versions return `{ transcript: "[unsupported replay schema vN]", truncated: true, eventCount: 0, durationMs: 0 }` rather than throwing — the MCP tool stays callable.

### Example output

```
Replay (28.4s, 412 events)

[+0.0s]  loaded /checkout?cart=abc-123 (Chrome 132 / macOS, viewport 1440×900)
[+1.2s]  click button.primary "Continue"
[+2.1s]  typed "alice@example.com" into input[name="email"]
[+3.4s]  typed "•••" into input[name="cardNumber"]
[+4.9s]  click button[type="submit"] "Pay $49.99"
[+5.8s]  console.error TypeError: Cannot read properties of undefined (reading 'token')
[+5.8s]  console.error at src/checkout/submit.ts:42:11
[+6.0s]  loaded /checkout/error
[+9.4s]  click a "Try again"
[+9.5s]  loaded /checkout?cart=abc-123
… (8 mouse interactions omitted) …
[+28.0s] click button.icon "Open feedback"
```

### Tests

Golden tests at `replay-transcript.test.ts` against fixtures in `apps/dashboard/server/mcp/__fixtures__/`:

- `checkout-error.json` — asserts the example timeline above
- `noisy-scroll.json` — asserts collapse of scrolls + mouse moves
- `masked-inputs.json` — asserts `•••` stays masked
- `no-fullsnapshot.json` — asserts graceful degradation
- `oversized.json` — asserts truncation + flag

## 7. Permissions & threat model

### Permission enforcement

Every tool handler runs through existing `permissions.ts` gates. MCP is just another caller of the existing service layer.

```ts
const userId = ctx.userId
const ticket = await db.query.tickets.findFirst({ where: eq(tickets.id, ticketId) })
if (!ticket) throw mcpError(NOT_FOUND)
await assertProjectRole(userId, ticket.projectId, "tickets.update")
// ... mutate
```

| Tool | Permission |
|---|---|
| `repro_list_projects` | implicit (only returns memberships) |
| All read tools (`list_tickets`, `get_ticket`, `list_ticket_comments`, `get_screenshot`, `get_replay_*`, `get_ticket_cookies`, `list_project_members`) | `tickets.read` |
| `repro_update_ticket` | `tickets.update` |
| `repro_add_comment` | `tickets.comment` |
| `repro_link_github_issue`, `repro_unlink_github_issue` | `integrations.link` |

If `permissions.ts` doesn't already encode the gate, the tool isn't shipped. **No new permission strings.**

### Audit trail

Add **one** new column to existing audit/event-log tables that record ticket writes: `actor_client_id text` (nullable). Populated from OAuth `client_id` on MCP calls; NULL on UI calls. Drives a future "made by Claude Desktop on behalf of jiajing@…" badge. Additive — doesn't change any existing query.

### Threat model

**1. Prompt injection from captured content.** Captured page content (replay transcripts, console logs, network bodies) is attacker-controlled if the reporter visited a malicious site. Layered mitigations:

- **No exfiltration tools.** No `repro_fetch_url`, no `repro_post_to_webhook`, no `repro_run_code`. Outbound surface is zero.
- **No destructive writes.** No `delete_*`. Worst case from injection: status change, comment, assignee change. All reversible in the UI in seconds.
- **No privilege escalation surface.** Cannot grant project membership, change roles, rotate keys, or reach settings.
- **Captured content is presented as data.** Tool responses wrap untrusted content in clearly-labeled fields. No tool response is structured as instructions.
- **Bounded blast radius per token.** 1h access token TTL; user can revoke any time at `/settings/mcp`.

**2. Token theft from AI clients.**
- Short access token TTL (1h).
- Refresh token rotation (`rotateRefreshTokens: true`).
- Disconnect at `/settings/mcp` deletes consent + tokens immediately.
- Tokens are NOT IP-bound — AI clients legitimately roam.

**3. Domain-allowlist drift.** Refresh-token use re-runs `isEmailDomainAllowed`. Newly-disallowed users lose access within 1h.

**4. Cross-origin / CSRF.** `/api/mcp` accepts `Authorization: Bearer` only — never cookies. CORS permissive (`Access-Control-Allow-Origin: *`) because MCP clients are local apps. No CSRF surface.

**5. Replay-content abuse by reporter.** A reporter could submit a replay containing prompt-injection payloads. Same mitigations as (1). The transcript reducer is deterministic textual reduction — it doesn't interpret content.

**6. Cookie content in `repro_get_ticket_cookies`.** Cookies captured at report time can contain session material from the *host app*. Three layers: existing intake-time denylist + HttpOnly invisibility, separate opt-in MCP tool, dashboard UI doc warning that admins should configure denylists.

**Out-of-scope risks (deferred / acknowledged):**
- AI clients that auto-approve OAuth consent. Not solvable from AS side; user education.
- AI providers logging tool I/O server-side. Operator decision.
- Per-tool consent ("Allow this tool?"). Not in MCP spec yet.

## 8. UI surface

### `/settings/mcp`

Two sections.

**Connect an AI assistant.** Copy-paste config for current major clients:
- Claude Desktop / Claude Code — `~/.claude/mcp_servers.json` snippet: `{ "repro": { "url": "<dashboard-origin>/api/mcp", "transport": "streamable-http" } }`.
- Cursor — same JSON shape, different config file path.
- ChatGPT custom connectors — paste dashboard origin into the connector dialog (auto-discovers via `/.well-known/oauth-protected-resource`).
- Generic — `npx mcp-remote <dashboard-origin>/api/mcp`.

Each block has a copy button. Dashboard origin auto-filled from current request so self-hosters don't substitute manually.

**Connected apps.** List from `oauth-provider`'s consent table for the current user. Per-row: client name (from RFC 7591 registration), connected date, last used at, scopes, "Disconnect" button. Disconnect deletes consent + revokes tokens.

### `/oauth/consent`

Covered in §4.

## 9. Dependencies, env, schema

### Runtime deps

- `@modelcontextprotocol/sdk` — official MCP server SDK.
- `better-auth` already pulled in; `oauth-provider` ships with it.

### Env vars (`server/lib/env.ts`)

| Name | Default | Purpose |
|---|---|---|
| `MCP_ENABLED` | `false` (v0.5), `true` (v0.6) | Feature gate the route + plugin |
| `MCP_ACCESS_TOKEN_TTL_SECONDS` | `3600` | Operator override |
| `MCP_RATE_LIMIT_PER_USER_PER_MINUTE` | `600` | Per-user rate cap on `/api/mcp` |

`BETTER_AUTH_URL` / `BETTER_AUTH_SECRET` reused.

### Schema changes

- `auth:gen` regenerates `auth-schema.ts` with `oauth-provider` tables (clients, codes, tokens, consents). **Do not hand-write SQL** — run `bun run db:gen` per project rule.
- One additive migration: `actor_client_id text` on existing audit/event-log tables that record ticket writes.

## 10. Testing

### Unit (`bun test`)

- `replay-transcript.test.ts` — golden fixtures (§6).
- `mcp/tools/*.test.ts` — handler-level. Each tool tested for: success, missing record (404), permission denied, input validation. `permissions.ts` imported as-is — never mocked.

### Integration (real Postgres)

- `mcp-oauth.integration.test.ts` — drives full OAuth flow against live Nuxt instance: discovery → register → authorize (programmatic via existing magic-link bypass helper) → token exchange → `/api/mcp` initialize → `tools/list` → call read tool → call write tool → assert audit row populated with `actor_client_id`. Uses `@modelcontextprotocol/sdk`'s `Client` with Streamable HTTP transport.
- `mcp-permissions.integration.test.ts` — asserts a `viewer` user is denied on `repro_update_ticket`; asserts domain-allowlist tightening kills next refresh.

### Negative tests

- Expired access token → 401.
- Wrong audience claim → 401.
- `repro_get_replay_raw` over size cap without `acknowledgeSize: true` → 413.

Per project rules: no DB mocks anywhere, no `any`, oxlint clean, oxfmt clean.

## 11. Rollout

- **v0.5.0** — ship behind `MCP_ENABLED=false`. All code, tests, docs in. Self-hosters can opt in. Internal validation against the team's own Repro instance for ~1 sprint.
- **v0.6.0** — flip default to `true`. `/settings/mcp` shows in nav for everyone.
- `CHANGELOG.md` migration note flagging the new audit column and the OAuth tables.
- VitePress docs page covering: how to connect each client, what the AI can do, how to revoke, security model summary, troubleshooting (trailing slash, CORS in browser-based clients, refresh-token loops).

## 12. Implementation sequence (risky-first)

1. **Replay transcript reducer** + tests. Pure, no auth surface. Catches rrweb-schema risk early.
2. **`oauth-provider` plugin wired in**, discovery endpoints reachable, consent page MVP. No MCP yet.
3. **Single Nitro `/api/mcp` route + `mcpHandler`** + one trivial read tool (`repro_list_projects`). Proves end-to-end loop.
4. **All read tools** in one batch (shared infrastructure).
5. **All write tools** + `actor_client_id` audit column.
6. **`/settings/mcp` UI** + connected-apps list.
7. **Integration test suite** (full OAuth dance against live stack).
8. **Docs** + flag flip prep.

## 13. Open items (non-blocking, deferred)

- **Scope shape.** v1 ships single `mcp:full`. A future `mcp:read` is additive.
- **Per-tool consent.** Not in MCP spec yet. Adopt when standardized.
- **`ticket://` resources.** Tools-only for v1. Add resources if real demand emerges.
- **MCP `list_changed` push.** Out of scope. AI clients poll. Adding push later doesn't reshape the tool surface.
- **Per-project consent scoping.** Account-wide for v1. Add if real abuse patterns emerge.
