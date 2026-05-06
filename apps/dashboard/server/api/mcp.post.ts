import { defineEventHandler, getRequestURL, sendWebResponse, readRawBody } from "h3"
import { mcpHandler } from "@better-auth/oauth-provider"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { env } from "../lib/env"
import { buildContextFromJwt } from "../mcp/context"
import { buildMcpServer } from "../mcp/server"

const handler = mcpHandler(
  {
    jwksUrl: `${env.BETTER_AUTH_URL}/api/auth/jwks`,
    verifyOptions: {
      issuer: env.BETTER_AUTH_URL,
      audience: `${env.BETTER_AUTH_URL}/api/mcp`,
    },
  },
  async (req: Request, jwt: Record<string, unknown>) => {
    const ctx = buildContextFromJwt(jwt)
    const server = buildMcpServer(ctx)
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    })
    await server.connect(transport)
    return transport.handleRequest(req)
  },
)

export default defineEventHandler(async (event) => {
  if (!env.MCP_ENABLED) {
    return sendWebResponse(event, new Response("MCP disabled", { status: 404 }))
  }
  const url = getRequestURL(event)
  const rawBody = await readRawBody(event, false)
  const init: RequestInit = {
    method: "POST",
    headers: event.headers,
    body: rawBody ? new Uint8Array(rawBody) : undefined,
  }
  const res = await handler(new Request(url, init))
  return sendWebResponse(event, res)
})
