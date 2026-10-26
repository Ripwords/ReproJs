// Regression test for audit 2026-10-26 §4 critical #2: the webhook recorded
// the X-GitHub-Delivery id BEFORE processing, so an event whose handler threw
// (transient DB error, malformed payload, …) was answered `202 replay` on
// GitHub's automatic redelivery and lost forever.
import { setup } from "../nuxt-setup"
import { afterEach, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import { createHmac } from "node:crypto"
import { eq } from "drizzle-orm"
import { db } from "../../server/db"
import { githubIntegrations, githubWebhookDeliveries } from "../../server/db/schema"
import {
  createUser,
  seedGithubApp,
  seedProject,
  truncateDomain,
  truncateGithub,
  truncateGithubApp,
  truncateReports,
} from "../helpers"

await setup({ server: true, port: 3000, host: "localhost" })
setDefaultTimeout(30000)

const BASE_URL = process.env.TEST_BASE_URL ?? "http://localhost:3000"
const SECRET = "test-webhook-secret"
const PK = "rp_pk_REDELIVERY0000000000000"
const INSTALLATION_ID = 777_001

function sign(payload: string): string {
  return `sha256=${createHmac("sha256", SECRET).update(payload).digest("hex")}`
}

async function sendWebhook(eventName: string, body: unknown, deliveryId: string) {
  const raw = JSON.stringify(body)
  const res = await fetch(`${BASE_URL}/api/integrations/github/webhook`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-github-event": eventName,
      "x-github-delivery": deliveryId,
      "x-hub-signature-256": sign(raw),
    },
    body: raw,
  })
  const text = await res.text()
  let json: Record<string, unknown> = {}
  try {
    json = JSON.parse(text) as Record<string, unknown>
  } catch {
    // non-JSON error page
  }
  return { status: res.status, body: json }
}

async function deliveryRows(deliveryId: string) {
  return db
    .select()
    .from(githubWebhookDeliveries)
    .where(eq(githubWebhookDeliveries.deliveryId, deliveryId))
}

beforeAll(async () => {
  await truncateGithubApp()
  await seedGithubApp()
})

describe("webhook redelivery after a failed attempt", () => {
  afterEach(async () => {
    await db.delete(githubWebhookDeliveries)
    await truncateGithub()
    await truncateReports()
    await truncateDomain()
  })

  test("a delivery whose processing throws is not remembered, so the redelivery is processed", async () => {
    const owner = await createUser("owner-redelivery@example.com", "admin")
    const pid = await seedProject({
      name: "redelivery",
      publicKey: PK,
      allowedOrigins: ["http://localhost:4000"],
      createdBy: owner,
    })
    await db.insert(githubIntegrations).values({
      projectId: pid,
      installationId: INSTALLATION_ID,
      repoOwner: "acme",
      repoName: "frontend",
      status: "connected",
    })

    const deliveryId = crypto.randomUUID()

    // First attempt: a payload the handler cannot process (issues.closed with
    // no repository block) — stands in for any transient failure mid-handler.
    const first = await sendWebhook(
      "issues",
      {
        action: "closed",
        issue: { number: 1, state: "closed", labels: [] },
        installation: { id: INSTALLATION_ID },
      },
      deliveryId,
    )
    expect(first.status).toBeGreaterThanOrEqual(500)
    expect(await deliveryRows(deliveryId)).toHaveLength(0)

    // GitHub redelivers under the same GUID. Before the fix this returned
    // `{ status: "replay" }` and the integration stayed connected.
    const second = await sendWebhook(
      "installation",
      { action: "suspend", installation: { id: INSTALLATION_ID } },
      deliveryId,
    )
    expect(second.status).toBe(202)
    expect(second.body.status).not.toBe("replay")

    const [row] = await db
      .select({ status: githubIntegrations.status })
      .from(githubIntegrations)
      .where(eq(githubIntegrations.projectId, pid))
    expect(row?.status).toBe("disconnected")
    expect(await deliveryRows(deliveryId)).toHaveLength(1)
  })

  test("installation.unsuspend restores a suspended integration to connected", async () => {
    const owner = await createUser("owner-unsuspend@example.com", "admin")
    const pid = await seedProject({
      name: "unsuspend",
      publicKey: PK,
      allowedOrigins: ["http://localhost:4000"],
      createdBy: owner,
    })
    await db.insert(githubIntegrations).values({
      projectId: pid,
      installationId: INSTALLATION_ID,
      repoOwner: "acme",
      repoName: "frontend",
      status: "connected",
    })
    // A second project on the same installation that never picked a repo must
    // stay disconnected — it has nowhere to sync to until the picker runs.
    const pidNoRepo = await seedProject({
      name: "unsuspend-norepo",
      publicKey: PK + "-norepo",
      allowedOrigins: ["http://localhost:4000"],
      createdBy: owner,
    })
    await db.insert(githubIntegrations).values({
      projectId: pidNoRepo,
      installationId: INSTALLATION_ID,
      status: "disconnected",
    })

    const suspended = await sendWebhook(
      "installation",
      { action: "suspend", installation: { id: INSTALLATION_ID } },
      crypto.randomUUID(),
    )
    expect(suspended.status).toBe(202)
    const restored = await sendWebhook(
      "installation",
      { action: "unsuspend", installation: { id: INSTALLATION_ID } },
      crypto.randomUUID(),
    )
    expect(restored.status).toBe(202)

    const rows = await db
      .select({ projectId: githubIntegrations.projectId, status: githubIntegrations.status })
      .from(githubIntegrations)
      .where(eq(githubIntegrations.installationId, INSTALLATION_ID))
    const byProject = new Map(rows.map((r) => [r.projectId, r.status]))
    expect(byProject.get(pid)).toBe("connected")
    expect(byProject.get(pidNoRepo)).toBe("disconnected")
  })

  test("a successfully processed delivery is still deduplicated on replay", async () => {
    const owner = await createUser("owner-replay@example.com", "admin")
    const pid = await seedProject({
      name: "replay",
      publicKey: PK,
      allowedOrigins: ["http://localhost:4000"],
      createdBy: owner,
    })
    await db.insert(githubIntegrations).values({
      projectId: pid,
      installationId: INSTALLATION_ID,
      repoOwner: "acme",
      repoName: "frontend",
      status: "connected",
    })
    const deliveryId = crypto.randomUUID()
    const body = { action: "suspend", installation: { id: INSTALLATION_ID } }

    const first = await sendWebhook("installation", body, deliveryId)
    expect(first.status).toBe(202)
    const second = await sendWebhook("installation", body, deliveryId)
    expect(second.status).toBe(202)
    expect(second.body.status).toBe("replay")
  })
})
