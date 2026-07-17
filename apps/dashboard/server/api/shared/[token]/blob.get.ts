import {
  createError,
  defineEventHandler,
  getHeader,
  getRouterParam,
  sendStream,
  setHeader,
  setResponseStatus,
} from "h3"
import { parseRangeHeader } from "../../../lib/range"
import { findLiveSharedMedia } from "../../../lib/shared-media"
import { getStorage } from "../../../lib/storage"

// Public Range-streaming blob for a shared-media token. Same uniform 404
// rule as index.get.ts — unknown, expired, and revoked tokens are
// indistinguishable.
export default defineEventHandler(async (event) => {
  const token = getRouterParam(event, "token") ?? ""
  const row = await findLiveSharedMedia(token)
  if (!row) throw createError({ statusCode: 404, statusMessage: "Not found" })

  const storage = await getStorage()
  const range = parseRangeHeader(getHeader(event, "range"), row.sizeBytes)

  setHeader(event, "Accept-Ranges", "bytes")
  setHeader(event, "X-Content-Type-Options", "nosniff")
  setHeader(event, "Content-Type", row.mime)

  if (range === "unsatisfiable") {
    setHeader(event, "Content-Range", `bytes */${row.sizeBytes}`)
    throw createError({ statusCode: 416, statusMessage: "Range Not Satisfiable" })
  }

  const s = await storage.getStream(row.storageKey, range ?? undefined)
  if (range) {
    setResponseStatus(event, 206)
    setHeader(event, "Content-Range", `bytes ${s.start}-${s.end}/${s.totalBytes}`)
  }
  setHeader(event, "Content-Length", s.end - s.start + 1)
  return sendStream(event, s.stream)
})
