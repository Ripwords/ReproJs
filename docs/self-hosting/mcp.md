---
title: AI assistants (MCP)
---

# AI assistants (MCP)

Repro can act as an OAuth 2.1 authorization server and an MCP resource server, letting AI assistants (Claude Desktop, Cursor, ChatGPT, …) connect to your instance through a per-user OAuth flow. This page covers the operator-side concerns: enabling it, the database migration, and the security model.

## Enabling MCP

Set `MCP_ENABLED=true` in your environment. From v0.6.0 this is the default; in v0.5.x it required an explicit opt-in.

```bash
MCP_ENABLED=true
```

When the flag is off, the `/api/mcp` endpoint returns 404, the `/.well-known/oauth-authorization-server/api/auth` discovery endpoint returns 404, and the better-auth `oauth-provider` plugin is not loaded. Existing dashboard auth (magic link, GitHub OAuth) is unaffected.

## Tunables

| Variable | Default | Purpose |
|---|---|---|
| `MCP_ENABLED` | `true` | Master toggle. Set to `false` to disable MCP entirely. |
| `MCP_ACCESS_TOKEN_TTL_SECONDS` | `3600` (1h) | How long an access token is valid before refresh. Shorter is safer; longer reduces token-refresh chatter. |
| `MCP_RATE_LIMIT_PER_USER_PER_MINUTE` | `600` | Per-user rate cap on `/api/mcp`. AI clients are chatty — leave this generous unless you see abuse. |

`BETTER_AUTH_URL` and `BETTER_AUTH_SECRET` are reused; no new auth secrets to manage.

## Database changes

Migration `0017_cute_toxin` adds two columns; `oauth-provider` plugin tables (jwks, oauth_client, oauth_access_token, oauth_refresh_token, oauth_consent) were added earlier in `0016`. The two new columns from `0017`:

- `report_events.actor_client_id text` — populated with the OAuth `client_id` when a write came through MCP, NULL when it came through the dashboard UI.
- `report_comments.actor_client_id text` — same.

Apply migrations the standard way:

```bash
bun run db:migrate
```

(or `db:push` for dev iteration).

The migrations are purely additive — no existing tables are altered or dropped.

## How the OAuth flow looks

1. AI client fetches `https://<your-repro>/.well-known/oauth-authorization-server/api/auth` for endpoint discovery (RFC 8414).
2. Client registers via `POST /api/auth/oauth2/register` (RFC 7591 — anonymous; this only registers a client, not a grant).
3. Client opens the user's browser to `/api/auth/oauth2/authorize?...` with PKCE.
4. The user signs in (existing flow) and lands on `/oauth/consent` — they click Allow.
5. Client exchanges the code for a JWT access token at `/api/auth/oauth2/token` with the `resource` indicator set to `<your-repro>/api/mcp`.
6. All subsequent MCP calls go to `/api/mcp` with `Authorization: Bearer <jwt>`.

## Audit trail

Every change made through MCP is recorded with `actor_client_id` set to the OAuth client_id. To find every change made by an MCP client on a particular ticket:

```sql
SELECT kind, payload, created_at, actor_client_id
FROM report_events
WHERE report_id = '<ticket-id>' AND actor_client_id IS NOT NULL
ORDER BY created_at DESC;
```

A future dashboard release will surface this as a badge on the activity feed; for now it's queryable directly.

## Security model

- **Per-user OAuth, no service tokens.** An assistant runs as a specific user with that user's project memberships and roles.
- **No exfiltration tools.** Repro's MCP surface has no `fetch_url`, `post_to_webhook`, or `run_code` tool. An AI ingesting attacker-controlled content (prompt-injected replay, console log) cannot exfiltrate data through the Repro surface.
- **No destructive writes.** No `delete_*` tool exists. The worst an injected prompt can do is mistakenly change a status or post a comment — both reversible in the UI in seconds.
- **Bounded blast radius.** Access tokens expire after 1 hour. Users can revoke any time at `/settings/mcp`.
- **Cookies are opt-in.** `repro_get_ticket` deliberately omits captured cookies. An AI must call `repro_get_ticket_cookies` explicitly. The tool description warns about session-token risk.

For more depth see the spec at [`docs/superpowers/specs/2026-05-06-mcp-oauth-server-design.md`](https://github.com/Ripwords/ReproJs/blob/main/docs/superpowers/specs/2026-05-06-mcp-oauth-server-design.md).

## Disabling

Set `MCP_ENABLED=false` and restart. The OAuth tables stay in the database (so existing consents are preserved if you re-enable later) but are unreachable. To clean up entirely, also revoke any consents from the dashboard UI before disabling.
