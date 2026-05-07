import { defineEventHandler, setResponseHeader } from "h3"
import { env } from "../../../../lib/env"

/**
 * RFC 9728 OAuth 2.0 Protected Resource Metadata.
 *
 * Returned to MCP clients that follow the WWW-Authenticate redirect from a
 * 401 response on /api/mcp. Tells them which authorization server issues
 * tokens for this resource and which scopes are recognized.
 *
 * URL path mirrors the resource: /api/mcp → /.well-known/oauth-protected-resource/api/mcp
 */
export default defineEventHandler((event) => {
  if (!env.MCP_ENABLED) {
    event.node.res.statusCode = 404
    return null
  }
  setResponseHeader(event, "Content-Type", "application/json")
  setResponseHeader(event, "Cache-Control", "public, max-age=3600")
  return {
    resource: `${env.BETTER_AUTH_URL}/api/mcp`,
    authorization_servers: [`${env.BETTER_AUTH_URL}/api/auth`],
    scopes_supported: ["mcp:full"],
    bearer_methods_supported: ["header"],
    resource_documentation: `${env.BETTER_AUTH_URL}/settings/mcp`,
  }
})
