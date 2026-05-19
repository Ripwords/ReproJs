# Admin overview charts + two refetch bug fixes

Date: 2026-05-19
Status: Approved (design)

## Summary

Three related changes to the admin dashboard:

- **A. Visualisations** — add graphical charts to the admin overview page: a
  reports-over-time trend, a status-distribution donut, and a top-projects-by-open
  bar chart.
- **B. Bug** — after deleting a project the projects list still shows the deleted
  project until a hard refresh.
- **C. Bug** — creating a GitHub issue from the triage sidebar doesn't reflect in
  the UI until a manual page refresh.

## Context

- `apps/dashboard/app/pages/admin/index.vue` already fetches a rich
  `AdminOverviewDTO` (`counts.byStatus`, `counts.byPriority`, `counts.last7Days`,
  `projects`, `recentReports`, `recentEvents`, `perProject`) but renders all of it
  as plain number tiles and lists — no charts.
- `apps/dashboard/server/api/admin/overview.get.ts` runs 9 parallel queries and
  shapes them into `AdminOverviewDTO` (defined in `packages/shared/src/admin.ts`,
  the single-sourced SDK/dashboard contract).
- No charting library is installed. Chosen: **`nuxt-charts`** (v2.1.4, wraps
  `vue-chrts`/Unovis, auto-imports chart components, Nuxt 4 compatible).
- Projects list: `apps/dashboard/app/pages/index.vue` fetches `/api/projects` via
  `useApi` (a `useFetch` wrapper — cached by Nuxt payload key).
- Project delete: `apps/dashboard/app/pages/projects/[id]/settings.vue`
  `confirmDelete()` does `DELETE /api/projects/:id` then `router.push("/")`.
- GitHub sync: `apps/dashboard/server/api/projects/[id]/reports/[reportId]/github-sync.post.ts`
  validates then calls `enqueueSync()` and returns `{ ok: true }` **immediately**;
  `enqueueSync` upserts a `reportSyncJobs` row and fires `triggerReportSync()`
  in-process **fire-and-forget**. Issue creation is therefore asynchronous.
- Triage sidebar: `apps/dashboard/app/components/report-drawer/triage-footer.vue`
  `createIssue()` POSTs then `emit("patched")`. Parent
  `apps/dashboard/app/pages/projects/[id]/reports/[reportId].vue` `onPatched()`
  calls `refresh()` on the report.

## Part A — Admin overview visualisations

### Data sources

| Chart | Source | Backend change |
|---|---|---|
| Reports over time (area, last 30 days) | new grouped-by-day query | **Yes** |
| Status distribution (donut) | `counts.byStatus` | None |
| Top projects by open reports (horizontal bar, top 8) | `perProject` (already sorted `openCount desc`) | None |

Priority distribution was explicitly excluded by the user.

### Backend

`packages/shared/src/admin.ts`:

- Add to `AdminOverviewDTO`:
  ```ts
  volume: z.array(z.object({ date: z.string(), count: z.number().int() })),
  ```
  `date` is a `YYYY-MM-DD` UTC day string; the array is ordered oldest → newest
  and **zero-filled** so every day in the 30-day window is present.

`apps/dashboard/server/api/admin/overview.get.ts`:

- Add `const TREND_DAYS = 30`.
- Add a 10th query to the existing `Promise.all`: reports grouped by UTC day,
  `innerJoin` projects with `isNull(projects.deletedAt)`, restricted to
  `createdAt >= (today - (TREND_DAYS - 1) days)`.
- Zero-fill in JS: build the full ordered list of 30 day-strings, map DB rows
  into it, default missing days to `0`. Reuse the existing `startOfUtcDay`
  helper and `DAY_MS`.
- Return `volume` in the response object.

### Frontend

- Add `nuxt-charts` to `apps/dashboard/package.json` dependencies.
- Add `"nuxt-charts"` to the `modules` array in
  `apps/dashboard/nuxt.config.ts` — **additive edit to the `modules` array
  only**, no other lines touched (the user maintains this file by hand).
- `apps/dashboard/app/pages/admin/index.vue`: add an "Insights" section
  **after the metric-tiles grid and before the Recent reports / Activity
  two-column block**:
  - Full-width card: **Reports over time** — `<AreaChart>` over `volume`,
    x = `date`, y = `count`.
  - Two-column row below: **Status distribution** `<DonutChart>` (open /
    in_progress / resolved / closed from `counts.byStatus`) +
    **Top projects by open reports** `<BarChart>` horizontal, top 8 of
    `perProject` by `openCount`.
- Reuse existing card chrome (`rounded-xl border border-default bg-default`,
  the `px-5 py-4 border-b` header pattern), theme-token colours, and the
  existing muted "No … yet" empty-state copy when a series has no data
  (e.g. zero total reports → trend/donut show the empty state instead of an
  empty chart).

### Notes / non-goals

- The dashboard is not under the SDK's bundle budget; loading charts on the
  admin route only is acceptable.
- No date-range picker / no per-project drill-down in this iteration (YAGNI).

## Part B — Bug: deleted project still listed

**Root cause:** `useApi("/api/projects")` payload is cached by Nuxt under an
auto-generated key. Client-side `router.push("/")` after delete re-mounts the
list page but `useFetch` returns the cached payload without refetching, so the
deleted project still renders.

**Fix:**

- `apps/dashboard/app/pages/index.vue`: give the fetch an explicit key —
  `useApi<ProjectDTO[]>("/api/projects", { key: "projects-list", default: () => [] })`.
- `apps/dashboard/app/pages/projects/[id]/settings.vue` `confirmDelete()`:
  after a successful `DELETE`, call `clearNuxtData("projects-list")` **before**
  `router.push("/")` so the list page refetches fresh data on mount.

## Part C — Bug: GitHub issue not reflected until manual refresh

**Root cause:** `github-sync.post.ts` enqueues a fire-and-forget worker and
returns immediately. The client's single `emit("patched")` → `refresh()` fires
instantly and races the GitHub API round-trip — it almost always loses, so the
refetched report has no `githubIssueNumber`. A later manual refresh works
because the worker has since completed.

**Fix (contained to `triage-footer.vue` `createIssue()`):**

- After the POST succeeds, **bounded-poll** the report endpoint directly:
  `GET /api/projects/:projectId/reports/:reportId`, every ~1s, up to ~12
  attempts (~12s cap), until `githubIssueNumber !== null`.
- Then `emit("patched")` **once** so the parent's `refresh()` returns
  consistent data. Keep `ghSubmitting` true for the whole poll so the button
  stays in its loading state.
- On timeout (worker slow / retrying), still `emit("patched")` and show an
  **informational** toast ("Issue is being created — it'll appear shortly")
  rather than a false error toast — the worker may still complete via its
  retry path.
- Surfacing hard worker failures is out of scope for this change.

## Testing (TDD)

- **Part A:** server test for the new `volume` query — zero-fill correctness
  (every day in the window present, gaps = 0, correct ordering) and
  deleted-project exclusion. Contract test that `AdminOverviewDTO` accepts the
  new `volume` shape.
- **Part B:** Postgres-backed integration test for the delete → list-refetch
  path (deleted project absent from `/api/projects` after `clearNuxtData`).
- **Part C:** test that `createIssue` polls until `githubIssueNumber` is set
  (worker/endpoint stubbed) and emits `patched` exactly once; and that a
  timeout still emits `patched` and shows the informational toast.

## File touch list

- `packages/shared/src/admin.ts` — extend `AdminOverviewDTO` with `volume`.
- `apps/dashboard/server/api/admin/overview.get.ts` — add `TREND_DAYS`, the
  grouped-by-day query, zero-fill, return `volume`.
- `apps/dashboard/package.json` — add `nuxt-charts`.
- `apps/dashboard/nuxt.config.ts` — add `nuxt-charts` to `modules` (additive).
- `apps/dashboard/app/pages/admin/index.vue` — Insights chart section.
- `apps/dashboard/app/pages/index.vue` — explicit `key` on the projects fetch.
- `apps/dashboard/app/pages/projects/[id]/settings.vue` — `clearNuxtData` on
  delete.
- `apps/dashboard/app/components/report-drawer/triage-footer.vue` — bounded
  poll in `createIssue()`.
- Test files colocated per project convention.
