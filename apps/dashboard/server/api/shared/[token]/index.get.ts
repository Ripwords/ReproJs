import { createError, defineEventHandler, getRouterParam } from "h3"
import { findLiveSharedMedia } from "../../../lib/shared-media"

// Public metadata for a shared-media token. Deliberately excludes every
// project-scoped field (id, projectId, token, storageKey) — this response
// is reachable by anyone with the link, so it must not leak which project
// or attachment row the clip belongs to.
export default defineEventHandler(async (event) => {
  const token = getRouterParam(event, "token") ?? ""
  const row = await findLiveSharedMedia(token)
  if (!row) throw createError({ statusCode: 404, statusMessage: "Not found" })

  return {
    kind: row.kind,
    mime: row.mime,
    sizeBytes: row.sizeBytes,
    durationMs: row.durationMs,
    trimStartMs: row.trimStartMs,
    trimEndMs: row.trimEndMs,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  }
})
