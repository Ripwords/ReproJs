// apps/dashboard/server/api/projects/[id]/reports/[reportId]/index.patch.ts
import { createError, defineEventHandler, getRouterParam, readValidatedBody } from "h3"
import { TriagePatchInput } from "@reprojs/shared"
import { db } from "../../../../../db"
import {
  applyTicketTriagePatch,
  applyTicketTriagePatchSideEffects,
} from "../../../../../lib/triage"
import { requireProjectRole } from "../../../../../lib/permissions"

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id")
  const reportId = getRouterParam(event, "reportId")
  if (!id || !reportId) throw createError({ statusCode: 400, statusMessage: "missing params" })
  const { session } = await requireProjectRole(event, id, "manager")
  const body = await readValidatedBody(event, (b: unknown) => TriagePatchInput.parse(b))

  const result = await db.transaction(async (tx) =>
    applyTicketTriagePatch(tx, {
      projectId: id,
      reportId,
      actorId: session.userId,
      actorClientId: null,
      body,
    }),
  )

  await applyTicketTriagePatchSideEffects(reportId, id, result)
  return { ok: result.ok, updated: result.updated }
})
