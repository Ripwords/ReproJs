---
title: AI assistants (MCP)
---

# AI assistants (MCP)

Repro exposes your tickets to AI assistants through the [Model Context Protocol](https://modelcontextprotocol.io). Once connected, an assistant like Claude Desktop or Cursor can read your reports, summarize triage, change ticket status, post comments, and link issues to GitHub — all using the same permissions you have in the dashboard.

## What you can do

Connected assistants can:

- **Read tickets and reports** — title, description, status, priority, tags, page context, system info, console + network logs, and a textual replay timeline.
- **Update triage** — change status, priority, tags, assignees (GitHub logins), and milestones.
- **Comment on tickets** — markdown comments, mirrored to GitHub if the ticket is linked.
- **Link / unlink GitHub issues** — connect a Repro ticket to an existing GitHub issue.

Assistants run **as you** — they can only read or change projects you're a member of, and they're bound by the same role permissions (viewer / manager / developer / owner). They cannot manage settings, members, or integrations.

## Tool reference

The server exposes these tools. Read tools need **viewer** on the project; write tools need **manager** or above. List tools are cursor-paginated (`limit` capped at 50, default 25) and return newest-first with a `nextCursor` (`null` when exhausted).

### Read

| Tool | Parameters | Notes |
|---|---|---|
| `repro_list_projects` | — | Projects you're a member of, with your role. |
| `repro_list_tickets` | `projectId`, `status[]?`, `priority[]?`, `tag[]?`, `query?`, `cursor?`, `limit?` | Filtered, paginated ticket list. |
| `repro_get_ticket` | `ticketId` | Full ticket: context, system info, console + network logs, replay transcript, attachments. **Cookies are not included.** |
| `repro_list_ticket_comments` | `ticketId`, `cursor?`, `limit?` | Paginated comment thread. |
| `repro_get_screenshot` | `ticketId` | Returns the screenshot as an image. Errors if larger than 1 MB. |
| `repro_get_replay_transcript` | `ticketId`, `verbosity?` (`"summary"` \| `"detailed"`) | Textual replay timeline; truncates with a `truncated` flag if oversized. |
| `repro_get_replay_raw` | `ticketId`, `acknowledgeSize?` | Raw rrweb event JSON. Errors above 200 KB unless `acknowledgeSize: true`. |
| `repro_get_ticket_cookies` | `ticketId` | **Opt-in.** Captured cookies — may include session tokens. |
| `repro_list_project_members` | `projectId` | Dashboard members and their project roles. |

### Write (manager and above)

| Tool | Parameters | Notes |
|---|---|---|
| `repro_update_ticket` | `ticketId` + at least one of `status?`, `priority?`, `tags?`, `assignees?` (GitHub logins), `milestone?` | Atomic partial update. Assignees/milestone require a connected GitHub integration. |
| `repro_add_comment` | `ticketId`, `body` (markdown, 1–65536 chars) | Mirrored to GitHub if the ticket is linked. |
| `repro_link_github_issue` | `ticketId`, `repoOwner`, `repoName`, `issueNumber` | Async; labels/assignees/status reconcile on the next sync tick. |
| `repro_unlink_github_issue` | `ticketId` | Idempotent — returns `{ unlinked: false }` if it wasn't linked. |

Errors are returned with typed codes: `NOT_FOUND` (404), `FORBIDDEN` (403, permission denied or disabled user), `INVALID_INPUT` (400), `PAYLOAD_TOO_LARGE` (413, screenshot > 1 MB or raw replay > 200 KB).

## Connect an assistant

Sign in to your dashboard and visit **Settings → AI assistants (MCP)**. The page shows ready-to-paste configuration for each major client.

### Claude Desktop / Claude Code

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or the equivalent on your platform:

```json
{
  "mcpServers": {
    "repro": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://<your-repro>/api/mcp"]
    }
  }
}
```

Restart Claude Desktop. The first time a tool is called, your browser opens to the Repro sign-in page (if you're not already signed in), then a consent screen — click **Allow**.

### Cursor

Add to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "repro": {
      "url": "https://<your-repro>/api/mcp",
      "transport": "streamable-http"
    }
  }
}
```

### ChatGPT custom connectors

Paste your dashboard URL into the connector dialog. ChatGPT auto-discovers the OAuth endpoints and walks you through sign-in.

### Other MCP clients

Any client that supports the Streamable HTTP transport works. The `mcp-remote` shim is a universal fallback:

```bash
npx mcp-remote https://<your-repro>/api/mcp
```

## How sign-in works

When an assistant first calls a tool:

1. Your browser opens to the Repro sign-in page (skip if already signed in).
2. After signing in, you see a consent screen listing the permissions the assistant is requesting.
3. Click **Allow** to grant access. The assistant receives a token and can call tools on your behalf.

Tokens expire after 1 hour. The assistant refreshes them automatically without prompting you again — until you disconnect.

## Revoking access

Visit **Settings → AI assistants (MCP)** and click **Disconnect** next to the assistant you want to revoke. This:

- Deletes the consent grant (next sign-in will re-prompt for permission).
- Invalidates the assistant's active tokens immediately.

You can disconnect any time without warning the assistant — it'll just start getting authentication errors.

## Troubleshooting

**The assistant says "401 Unauthorized" repeatedly.**
You disconnected it. Re-add the configuration above and reconnect.

**Browser opens but the consent page is blank.**
Confirm you're signed into the dashboard in the same browser. The consent flow uses your dashboard session.

**Tools can't see one of my projects.**
The assistant only sees projects you're a member of. Add yourself to the project in Settings → Members.

**Updates fail with "GitHub-only feature".**
Assignees and milestones are mirrored from GitHub, so they require a connected GitHub integration on the project. Set this up in Settings → Integrations.

## Privacy and security

- Captured cookies are **never** included in `repro_get_ticket`. To fetch them, an assistant must explicitly call the separate `repro_get_ticket_cookies` tool, and the tool's description warns about session tokens.
- Raw replay event streams are capped at 200 KB unless the assistant explicitly asks for the full payload.
- Every change made through MCP is recorded with the connecting client's identity (e.g. "Claude Desktop") in the audit trail.
- Assistants cannot delete tickets, change project settings, or manage members.

For the full security model see the [self-hosting docs](/self-hosting/mcp).
