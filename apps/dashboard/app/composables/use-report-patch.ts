import type { Ref } from "vue"
import type { ReportDetailDTO, TriagePatchInput } from "@reprojs/shared"
import { describeApiError } from "~/utils/api-error"

/** Body of PATCH /api/projects/:id/reports/:reportId — the shared Zod contract. */
export type ReportPatchBody = TriagePatchInput

/**
 * One PATCH path for every triage control on the report page (header
 * selects, triage panel). Status, priority and tags are applied to the
 * local report immediately so the UI answers at once; the server round-trip
 * then refreshes the real row. A failure rolls the local copy back and
 * shows the error — success is silent, the control itself shows the new
 * value.
 */
export function useReportPatch(opts: {
  projectId: () => string
  reportId: () => string
  report: Ref<ReportDetailDTO | null | undefined>
  afterPatch: () => Promise<void> | void
}) {
  const toast = useToast()
  const posting = ref(false)

  async function patch(body: ReportPatchBody): Promise<boolean> {
    const before = opts.report.value
    if (before) {
      const optimistic: Partial<ReportDetailDTO> = {}
      if (body.status !== undefined) optimistic.status = body.status
      if (body.priority !== undefined) optimistic.priority = body.priority
      if (body.tags !== undefined) optimistic.tags = body.tags
      if (Object.keys(optimistic).length > 0) {
        opts.report.value = { ...before, ...optimistic }
      }
    }

    posting.value = true
    try {
      await $fetch(`/api/projects/${opts.projectId()}/reports/${opts.reportId()}`, {
        method: "PATCH",
        body,
        credentials: "include",
      })
      await opts.afterPatch()
      return true
    } catch (err) {
      if (before) opts.report.value = before
      toast.add({
        title: "Could not save",
        description: describeApiError(err),
        color: "error",
        icon: "i-heroicons-exclamation-triangle",
      })
      return false
    } finally {
      posting.value = false
    }
  }

  return { patch, posting }
}
