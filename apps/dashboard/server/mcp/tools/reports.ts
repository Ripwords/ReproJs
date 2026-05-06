import { z } from "zod"
import { eq } from "drizzle-orm"
import { db } from "../../db"
import { reports, reportAttachments } from "../../db/schema"
import { requireProjectRoleByUser } from "../../lib/permissions"
import { mcpError } from "../errors"
import { getStorage } from "../../lib/storage"
import type { McpRequestContext } from "../context"

const SCREENSHOT_MAX_BYTES = 1024 * 1024 // 1 MB

export const getScreenshotTool = {
  name: "repro_get_screenshot",
  config: {
    description:
      "Fetch the annotated screenshot for a ticket as an inline image. Falls back to the unannotated screenshot if no annotated version exists. Returns an error if the image exceeds 1MB — fetch via the dashboard UI in that case.",
    inputSchema: z.object({
      ticketId: z.string().uuid(),
    }),
  },
  handler: async (input: { ticketId: string }, ctx: McpRequestContext) => {
    const [report] = await db
      .select({ projectId: reports.projectId })
      .from(reports)
      .where(eq(reports.id, input.ticketId))
      .limit(1)
    if (!report) throw mcpError("NOT_FOUND", `ticket ${input.ticketId} not found`)
    await requireProjectRoleByUser(ctx.userId, report.projectId, "viewer")

    const candidates = await db
      .select({
        kind: reportAttachments.kind,
        storageKey: reportAttachments.storageKey,
        contentType: reportAttachments.contentType,
        size: reportAttachments.sizeBytes,
      })
      .from(reportAttachments)
      .where(eq(reportAttachments.reportId, input.ticketId))

    const annotated = candidates.find((a) => a.kind === "annotated-screenshot")
    const screenshot = candidates.find((a) => a.kind === "screenshot")
    const chosen = annotated ?? screenshot
    if (!chosen) {
      throw mcpError("NOT_FOUND", `no screenshot attached to ticket ${input.ticketId}`)
    }
    if (chosen.size > SCREENSHOT_MAX_BYTES) {
      throw mcpError(
        "PAYLOAD_TOO_LARGE",
        `screenshot is ${chosen.size} bytes (max ${SCREENSHOT_MAX_BYTES}); view it in the Repro dashboard UI`,
      )
    }

    const storage = await getStorage()
    const obj = await storage.get(chosen.storageKey)
    const base64 = Buffer.from(obj.bytes).toString("base64")

    return {
      content: [
        {
          type: "image" as const,
          data: base64,
          mimeType: chosen.contentType,
        },
      ],
    }
  },
}
