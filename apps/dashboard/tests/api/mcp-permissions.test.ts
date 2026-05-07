import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { createHash, randomBytes } from "node:crypto"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { eq, sql } from "drizzle-orm"
import { db } from "../../server/db"
import { appSettings, projects, projectMembers, reports, user } from "../../server/db/schema"
import { apiFetch, createUser, signIn, truncateDomain } from "../helpers"

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000"

beforeAll(() => {
  if (process.env.MCP_ENABLED !== "true") {
    throw new Error("Run integration tests with MCP_ENABLED=true (the dev server too).")
  }
})

afterAll(async () => {
  await db
    .update(appSettings)
    .set({ allowedEmailDomains: [] })
    .where(sql`true`)
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
  email: string
}

async function setupAs(opts: {
  email: string
  role: "viewer" | "manager" | "developer" | "owner"
}): Promise<SetupResult> {
  await truncateDomain()
  await db
    .update(appSettings)
    .set({ allowedEmailDomains: [] })
    .where(sql`true`)

  const userId = await createUser(opts.email)
  const cookie = await signIn(opts.email)

  const projectId = crypto.randomUUID()
  await db.insert(projects).values({ id: projectId, name: "Perms Test", createdBy: userId })
  await db.insert(projectMembers).values({ projectId, userId, role: opts.role })

  const ticketId = crypto.randomUUID()
  await db.insert(reports).values({
    id: ticketId,
    projectId,
    title: "Test ticket",
    status: "open",
    priority: "normal",
    tags: [],
    source: "web",
    context: { source: "web", pageUrl: "https://example.com" },
  })

  const discovery = await fetch(`${BASE}/.well-known/oauth-authorization-server/api/auth`).then(
    (r) => r.json(),
  )
  const reg = await fetch(discovery.registration_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "Perms Test Client",
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

  const mcp = new Client({ name: "perms-test-client", version: "0.0.0" })
  const transport = new StreamableHTTPClientTransport(new URL(`${BASE}/api/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${tokenRes.access_token}` } },
  })
  await mcp.connect(transport)
  return { client: mcp, userId, projectId, ticketId, email: opts.email }
}

describe("MCP permissions and access control", () => {
  it("viewer is denied on repro_update_ticket", async () => {
    const { client, ticketId } = await setupAs({ email: "viewer@example.com", role: "viewer" })
    try {
      const result = await client.callTool({
        name: "repro_update_ticket",
        arguments: { ticketId, status: "in_progress" },
      })
      expect((result as { isError?: boolean }).isError).toBe(true)
      const txt = (result as { content?: Array<{ text?: string }> }).content?.[0]?.text ?? ""
      expect(txt).toMatch(/FORBIDDEN|insufficient/i)
    } finally {
      await client.close()
    }
  }, 30_000)

  it("disabled user is blocked from MCP", async () => {
    const { client, userId } = await setupAs({
      email: "disabled@example.com",
      role: "manager",
    })
    try {
      // Disable the user mid-session.
      await db.update(user).set({ status: "disabled" }).where(eq(user.id, userId))
      // The access check runs per request, so the next tool call should fail
      // with a 403. The MCP SDK surfaces transport-level 4xx as a thrown error.
      let threw = false
      try {
        await client.callTool({ name: "repro_list_projects", arguments: {} })
      } catch {
        threw = true
      }
      expect(threw).toBe(true)
    } finally {
      await client.close()
    }
  }, 30_000)

  it("post-hoc allowlist tightening blocks MCP calls", async () => {
    const { client } = await setupAs({
      email: "allowlist@example.com",
      role: "manager",
    })
    try {
      await db
        .update(appSettings)
        .set({ allowedEmailDomains: ["other-domain.com"] })
        .where(sql`true`)
      let threw = false
      try {
        await client.callTool({ name: "repro_list_projects", arguments: {} })
      } catch {
        threw = true
      }
      expect(threw).toBe(true)
    } finally {
      await client.close()
      // Reset for the next test.
      await db
        .update(appSettings)
        .set({ allowedEmailDomains: [] })
        .where(sql`true`)
    }
  }, 30_000)

  it("repro_get_replay_raw with no replay attached returns isError NOT_FOUND", async () => {
    const { client, ticketId } = await setupAs({
      email: "replay@example.com",
      role: "manager",
    })
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
