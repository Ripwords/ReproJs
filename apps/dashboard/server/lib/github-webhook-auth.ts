import { eq } from "drizzle-orm"
import { db } from "../db"
import { githubWebhookDeliveries } from "../db/schema/github-webhook-deliveries"
import { githubIntegrations } from "../db/schema/github-integrations"

export const MAX_WEBHOOK_BODY_BYTES = 5 * 1024 * 1024

export function checkBodySize(length: number | undefined): boolean {
  if (length === undefined) return true
  if (!Number.isFinite(length)) return false
  return length <= MAX_WEBHOOK_BODY_BYTES
}

export type DeliveryStatus = "new" | "replay"

export async function recordDelivery(deliveryId: string): Promise<DeliveryStatus> {
  const [inserted] = await db
    .insert(githubWebhookDeliveries)
    .values({ deliveryId })
    .onConflictDoNothing()
    .returning({ deliveryId: githubWebhookDeliveries.deliveryId })
  return inserted ? "new" : "replay"
}

/**
 * Release a delivery id so GitHub's automatic redelivery of the same GUID is
 * processed instead of being answered `202 replay`. Called when processing
 * threw after `recordDelivery` had already claimed the id — otherwise a
 * transient DB or network failure would drop that event forever.
 */
export async function forgetDelivery(deliveryId: string): Promise<void> {
  await db.delete(githubWebhookDeliveries).where(eq(githubWebhookDeliveries.deliveryId, deliveryId))
}

export async function isKnownInstallation(installationId: number): Promise<boolean> {
  const [row] = await db
    .select({ projectId: githubIntegrations.projectId })
    .from(githubIntegrations)
    .where(eq(githubIntegrations.installationId, installationId))
    .limit(1)
  return !!row
}
