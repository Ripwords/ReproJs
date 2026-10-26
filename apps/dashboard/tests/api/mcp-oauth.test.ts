import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { createHash, randomBytes } from "node:crypto"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { db } from "../../server/db"
import { projects, projectMembers } from "../../server/db/schema"
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

describe("MCP OAuth + Streamable HTTP", () => {
  it("end-to-end: discovery → register → authorize → token → tools/call", async () => {
    await truncateDomain()
    const userId = await createUser("mcp-user@example.com")
    const cookie = await signIn("mcp-user@example.com")
    const projectId = crypto.randomUUID()
    await db.insert(projects).values({
      id: projectId,
      name: "MCP Test",
      createdBy: userId,
    })
    await db.insert(projectMembers).values({ projectId, userId, role: "developer" })

    // 1. Discovery
    const discoveryUrl = `${BASE}/.well-known/oauth-authorization-server/api/auth`
    const discovery = (await fetch(discoveryUrl).then((r) => r.json())) as {
      issuer: string
      authorization_endpoint: string
      token_endpoint: string
      registration_endpoint: string
    }
    expect(discovery.issuer).toBeDefined()
    expect(discovery.authorization_endpoint).toBeDefined()
    expect(discovery.token_endpoint).toBeDefined()
    expect(discovery.registration_endpoint).toBeDefined()

    // 2. Dynamic client registration
    const reg = (await fetch(discovery.registration_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: "Test MCP Client",
        redirect_uris: [`${BASE}/oauth-test-callback`],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      }),
    }).then((r) => r.json())) as { client_id: string }
    expect(reg.client_id).toBeDefined()

    // 3. Authorize: simulate the user clicking "Allow".
    //    better-auth's oauthProvider consent endpoint expects:
    //      { accept, oauth_query }  (forwarded by /api/oauth/consent)
    const { verifier, challenge } = pkce()
    const authorizeUrl = new URL(discovery.authorization_endpoint)
    authorizeUrl.searchParams.set("response_type", "code")
    authorizeUrl.searchParams.set("client_id", reg.client_id)
    authorizeUrl.searchParams.set("redirect_uri", `${BASE}/oauth-test-callback`)
    authorizeUrl.searchParams.set("scope", "mcp:full")
    authorizeUrl.searchParams.set("code_challenge", challenge)
    authorizeUrl.searchParams.set("code_challenge_method", "S256")
    authorizeUrl.searchParams.set("state", "test-state")
    const authorizeRes = await fetch(authorizeUrl.toString(), {
      headers: { cookie },
      redirect: "manual",
    })
    let location = authorizeRes.headers.get("location") ?? ""

    // The authorize endpoint redirects to the consent page when the user
    // hasn't granted consent yet.
    if (location.includes("/oauth/consent")) {
      // Extract the signed oauth_query from the consent redirect URL and
      // POST the Allow decision to /api/oauth/consent.
      const consentLocationUrl = new URL(location, BASE)
      // The query string from the consent page URL is the signed oauth_query
      // that better-auth needs to restore the flow state.
      const oauthQuery = consentLocationUrl.search.replace(/^\?/, "")
      const decision = await apiFetch<{ redirectUri: string }>("/api/oauth/consent", {
        method: "POST",
        headers: { cookie },
        body: JSON.stringify({ oauthQuery, allow: true }),
      })
      expect(decision.status).toBe(200)
      location = decision.body.redirectUri
    }

    const code = new URL(location, BASE).searchParams.get("code")
    expect(code).toBeTruthy()
    if (!code) throw new Error("missing code param in redirect")

    // 4. Token exchange — include `resource` so the oauth provider issues a
    //    JWT access token (RFC 8707: resource indicators). Without `resource`,
    //    better-auth's oauthProvider has no audience to set and falls back to
    //    an opaque token which the mcpHandler cannot verify via JWKS.
    const tokenRes = (await fetch(discovery.token_endpoint, {
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
    }).then((r) => r.json())) as { access_token?: string; token_type?: string; error?: string }
    expect(tokenRes.access_token).toBeDefined()
    expect(tokenRes.token_type).toMatch(/bearer/i)

    // 5. MCP — tools/list and tools/call via the official SDK client
    const client = new Client({ name: "test-client", version: "0.0.0" })
    const transport = new StreamableHTTPClientTransport(new URL(`${BASE}/api/mcp`), {
      requestInit: {
        headers: { authorization: `Bearer ${tokenRes.access_token}` },
      },
    })
    await client.connect(transport)

    const tools = await client.listTools()
    const toolNames = tools.tools.map((t) => t.name)
    // Phase 1 acceptance: the two read tools the OAuth-flow proves can be
    // round-tripped. Later phases extend the registry; assert the Phase 1
    // tools are present without freezing the total count.
    expect(toolNames).toContain("repro_list_projects")
    expect(toolNames).toContain("repro_get_ticket")
    expect(toolNames.length).toBeGreaterThanOrEqual(2)

    const listResult = await client.callTool({
      name: "repro_list_projects",
      arguments: {},
    })
    const text = (listResult.content?.[0] as { text?: string } | undefined)?.text ?? "[]"
    const projectsResult = JSON.parse(text) as Array<{ id: string; name: string }>
    expect(projectsResult.find((p) => p.id === projectId)).toBeDefined()

    await client.close()
  }, 30_000)
})
