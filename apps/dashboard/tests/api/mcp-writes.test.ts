import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { createHash, randomBytes } from "node:crypto"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { eq } from "drizzle-orm"
import { db } from "../../server/db"
import {
  projects,
  projectMembers,
  reports,
  reportComments,
  reportEvents,
} from "../../server/db/schema"
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
  clientId: string
  userId: string
  projectId: string
  ticketId: string
}

async function setup(): Promise<SetupResult> {
  await truncateDomain()
  const userId = await createUser("phase3-mcp@example.com")
  const cookie = await signIn("phase3-mcp@example.com")

  const projectId = crypto.randomUUID()
  await db.insert(projects).values({ id: projectId, name: "P3 Test", createdBy: userId })
  await db.insert(projectMembers).values({ projectId, userId, role: "manager" })

  const ticketId = crypto.randomUUID()
  await db.insert(reports).values({
    id: ticketId,
    projectId,
    title: "Test ticket",
    status: "open",
    priority: "normal",
    tags: ["initial"],
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
      client_name: "Phase3 Test Client",
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

  const mcp = new Client({ name: "phase3-test-client", version: "0.0.0" })
  const transport = new StreamableHTTPClientTransport(new URL(`${BASE}/api/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${tokenRes.access_token}` } },
  })
  await mcp.connect(transport)
  return { client: mcp, clientId: reg.client_id, userId, projectId, ticketId }
}

describe("MCP Phase 3 write tools", () => {
  it("repro_update_ticket: status + priority + tags, audit row carries actor_client_id", async () => {
    const { client, clientId, ticketId } = await setup()
    try {
      await client.callTool({
        name: "repro_update_ticket",
        arguments: {
          ticketId,
          status: "in_progress",
          priority: "high",
          tags: ["initial", "frontend"],
        },
      })

      const [report] = await db.select().from(reports).where(eq(reports.id, ticketId))
      expect(report?.status).toBe("in_progress")
      expect(report?.priority).toBe("high")
      expect(report?.tags).toContain("frontend")

      const events = await db.select().from(reportEvents).where(eq(reportEvents.reportId, ticketId))
      expect(events.length).toBeGreaterThan(0)
      // Every event from this MCP call should carry the OAuth client_id.
      expect(events.every((e) => e.actorClientId === clientId)).toBe(true)
    } finally {
      await client.close()
    }
  }, 30_000)

  it("repro_add_comment: persists comment with actor_client_id", async () => {
    const { client, clientId, ticketId } = await setup()
    try {
      await client.callTool({
        name: "repro_add_comment",
        arguments: { ticketId, body: "Triaged by Claude" },
      })
      const [comment] = await db
        .select()
        .from(reportComments)
        .where(eq(reportComments.reportId, ticketId))
      expect(comment?.body).toBe("Triaged by Claude")
      expect(comment?.actorClientId).toBe(clientId)
      expect(comment?.source).toBe("dashboard")
    } finally {
      await client.close()
    }
  }, 30_000)

  it("repro_link_github_issue: returns isError when project has no GitHub integration", async () => {
    const { client, ticketId } = await setup()
    try {
      const result = await client.callTool({
        name: "repro_link_github_issue",
        arguments: { ticketId, repoOwner: "acme", repoName: "frontend", issueNumber: 42 },
      })
      expect((result as { isError?: boolean }).isError).toBe(true)
    } finally {
      await client.close()
    }
  }, 30_000)

  it("repro_unlink_github_issue: idempotent on already-unlinked ticket", async () => {
    const { client, ticketId } = await setup()
    try {
      const result = await client.callTool({
        name: "repro_unlink_github_issue",
        arguments: { ticketId },
      })
      const text = (result as { content?: Array<{ text?: string }> }).content?.[0]?.text ?? "{}"
      const parsed = JSON.parse(text) as { ok: boolean; unlinked: boolean }
      expect(parsed.ok).toBe(true)
      expect(parsed.unlinked).toBe(false)
    } finally {
      await client.close()
    }
  }, 30_000)
})
