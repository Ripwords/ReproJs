// apps/dashboard/server/tasks/media/purge.ts
// Nitro scheduled task — nightly sweep that deletes expired and long-revoked
// shared_media rows plus their storage blobs. See ../../lib/shared-media-purge
// for the selection rule and boundary semantics.
import { defineTask } from "nitropack/runtime"
import { purgeSharedMedia } from "../../lib/shared-media-purge"

export default defineTask({
  meta: {
    name: "media:purge",
    description: "Delete expired and revoked shared media",
  },
  async run() {
    const { purged } = await purgeSharedMedia()
    return { result: "ok", purged }
  },
})
