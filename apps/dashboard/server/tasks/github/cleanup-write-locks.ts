// apps/dashboard/server/tasks/github/cleanup-write-locks.ts
// Nitro scheduled task — daily GitHub-integration housekeeping.
//   * Purges expired github_write_locks rows. Write-locks have a 30s TTL and
//     are consumed on first matching webhook, so this is an insurance sweep
//     for any rows that were never consumed.
//   * Prunes github_webhook_deliveries older than the redelivery window so
//     the dedupe table doesn't grow by one row per webhook forever.
import { defineTask } from "nitropack/runtime"
import { db } from "../../db"
import { cleanupExpiredLocks } from "../../lib/github-write-locks"
import { pruneWebhookDeliveries } from "../../lib/github-webhook-auth"

export default defineTask({
  meta: {
    name: "github:cleanup-write-locks",
    description:
      "Delete expired github_write_locks rows and prune old github_webhook_deliveries (daily housekeeping)",
  },
  async run() {
    const deleted = await cleanupExpiredLocks(db)
    const deliveriesPruned = await pruneWebhookDeliveries()
    return { result: "ok", deleted, deliveriesPruned }
  },
})
