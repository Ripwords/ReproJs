import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { listProjectsTool } from "./tools/projects"
import { getTicketTool } from "./tools/tickets"
import type { McpRequestContext } from "./context"
import { McpToolError } from "./errors"

/**
 * Per-request MCP server factory. We instantiate fresh per request rather
 * than caching a singleton because each tool handler closes over the
 * request's userId/clientId — a singleton would force us to thread context
 * through every call site, which is messier than recreating the server.
 * Construction is cheap (just registerTool calls).
 */
export function buildMcpServer(ctx: McpRequestContext): McpServer {
  const server = new McpServer({ name: "repro", version: "0.5.0" })

  server.registerTool(listProjectsTool.name, listProjectsTool.config, async (input) => {
    try {
      return await listProjectsTool.handler(input as Record<string, never>, ctx)
    } catch (err) {
      return toolErrorResult(err)
    }
  })

  server.registerTool(getTicketTool.name, getTicketTool.config, async (input) => {
    try {
      return await getTicketTool.handler(input as { ticketId: string }, ctx)
    } catch (err) {
      return toolErrorResult(err)
    }
  })

  return server
}

function toolErrorResult(err: unknown): {
  content: Array<{ type: "text"; text: string }>
  isError: true
} {
  if (err instanceof McpToolError) {
    return {
      content: [{ type: "text", text: `${err.code}: ${err.message}` }],
      isError: true,
    }
  }
  // h3 createError thrown from requireProjectRoleByUser
  if (
    err &&
    typeof err === "object" &&
    "statusCode" in err &&
    typeof (err as { statusCode: unknown }).statusCode === "number"
  ) {
    const e = err as { statusCode: number; statusMessage?: string }
    const code = e.statusCode === 403 ? "FORBIDDEN" : e.statusCode === 404 ? "NOT_FOUND" : "ERROR"
    return {
      content: [{ type: "text", text: `${code}: ${e.statusMessage ?? "request failed"}` }],
      isError: true,
    }
  }
  const msg = err instanceof Error ? err.message : String(err)
  return { content: [{ type: "text", text: `ERROR: ${msg}` }], isError: true }
}
