// MCP errors thrown by tool handlers. The route handler in api/mcp.post.ts
// catches McpToolError and returns it via the MCP protocol's standard
// JSON-RPC error envelope. Anything else propagates and 500s.

export type McpErrorCode = "NOT_FOUND" | "FORBIDDEN" | "INVALID_INPUT" | "PAYLOAD_TOO_LARGE"

export class McpToolError extends Error {
  readonly code: McpErrorCode

  constructor(code: McpErrorCode, message: string) {
    super(message)
    this.code = code
    this.name = "McpToolError"
  }
}

const HTTP_BY_CODE: Record<McpErrorCode, number> = {
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  INVALID_INPUT: 400,
  PAYLOAD_TOO_LARGE: 413,
}

export function httpStatusForMcpError(err: McpToolError): number {
  return HTTP_BY_CODE[err.code]
}

export function mcpError(code: McpErrorCode, message: string): McpToolError {
  return new McpToolError(code, message)
}
