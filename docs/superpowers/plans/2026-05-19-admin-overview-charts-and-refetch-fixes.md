# Admin Overview Charts + Refetch Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three charts to the admin overview page (reports-over-time, status-distribution, top-projects-by-open) and fix two stale-data bugs: deleted projects lingering in the list, and GitHub-issue creation not reflecting until a manual refresh.

**Architecture:** Backend extends the existing single `AdminOverviewDTO` contract with a zero-filled 30-day `volume` series; the admin page renders charts via the `nuxt-charts` module. Bug B is a Nuxt payload-cache invalidation (explicit fetch key + `clearNuxtData` on delete). Bug C extracts a pure, unit-tested `pollUntil` helper and uses it in the triage sidebar to wait out the async GitHub-sync worker before refetching.

**Tech Stack:** Nuxt 4 (Vue 3, Nitro), Drizzle ORM + Postgres, Zod (`@reprojs/shared`), `nuxt-charts` (v2.x, wraps `vue-chrts`/Unovis), `bun test`.

**Spec:** `docs/superpowers/specs/2026-05-19-admin-overview-charts-and-refetch-fixes-design.md`

---

## File Structure

**Create:**
- `packages/shared/src/admin.test.ts` — zod contract test for the extended DTO.
- `apps/dashboard/app/composables/use-poll-until.ts` — pure bounded-poll helper.
- `apps/dashboard/tests/composables/use-poll-until.test.ts` — unit test for the helper.

**Modify:**
- `packages/shared/src/admin.ts` — add `volume` to `AdminOverviewDTO`.
- `apps/dashboard/server/api/admin/overview.get.ts` — `TREND_DAYS`, volume query, zero-fill, return `volume`.
- `apps/dashboard/tests/api/admin-overview.test.ts` — volume coverage + deleted-project exclusion for `/api/projects`.
- `apps/dashboard/package.json` — add `nuxt-charts`.
- `apps/dashboard/nuxt.config.ts` — add `"nuxt-charts"` to the `modules` array (additive — only that array).
- `apps/dashboard/app/pages/admin/index.vue` — Insights chart section.
- `apps/dashboard/app/pages/index.vue` — explicit `key` on the projects fetch.
- `apps/dashboard/app/pages/projects/[id]/settings.vue` — `clearNuxtData` after delete.
- `apps/dashboard/app/components/report-drawer/triage-footer.vue` — use `pollUntil` in `createIssue()`.

---

## Task 1: Extend `AdminOverviewDTO` with `volume`

**Files:**
- Modify: `packages/shared/src/admin.ts`
- Test: `packages/shared/src/admin.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/admin.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { AdminOverviewDTO } from "./admin"

const base = {
  counts: { total: 0, byStatus: {}, byPriority: {}, last7Days: 0 },
  projects: { total: 0, withGithub: 0 },
  recentReports: [],
  recentEvents: [],
  perProject: [],
}

describe("AdminOverviewDTO.volume", () => {
  test("accepts a zero-filled volume series", () => {
    const parsed = AdminOverviewDTO.parse({
      ...base,
      volume: [
        { date: "2026-05-18", count: 3 },
        { date: "2026-05-19", count: 0 },
      ],
    })
    expect(parsed.volume).toEqual([
      { date: "2026-05-18", count: 3 },
      { date: "2026-05-19", count: 0 },
    ])
  })

  test("rejects a payload missing volume", () => {
    expect(() => AdminOverviewDTO.parse(base)).toThrow()
  })

  test("rejects a non-integer count", () => {
    expect(() =>
      AdminOverviewDTO.parse({ ...base, volume: [{ date: "2026-05-19", count: 1.5 }] }),
    ).toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/shared/src/admin.test.ts`
Expected: FAIL — first test throws because `volume` is not yet a key in the schema (the parse strips/ignores it so `parsed.volume` is `undefined`), and the "rejects missing" test fails because the base parses fine today.

- [ ] **Step 3: Add `volume` to the schema**

In `packages/shared/src/admin.ts`, inside the `AdminOverviewDTO = z.object({ ... })` definition, add a `volume` field immediately after `perProject`:

```ts
  perProject: z.array(AdminProjectBreakdownDTO),
  // Zero-filled daily report counts for the trend chart. Ordered oldest →
  // newest; every UTC day in the trailing window is present (gaps = 0).
  // `date` is a `YYYY-MM-DD` UTC day string.
  volume: z.array(
    z.object({
      date: z.string(),
      count: z.number().int(),
    }),
  ),
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/shared/src/admin.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/admin.ts packages/shared/src/admin.test.ts
git commit -m "feat(shared): add volume series to AdminOverviewDTO"
```

---

## Task 2: Add the 30-day volume query to the overview endpoint

**Files:**
- Modify: `apps/dashboard/server/api/admin/overview.get.ts`
- Test: `apps/dashboard/tests/api/admin-overview.test.ts:1` (extend existing suite)

- [ ] **Step 1: Write the failing test**

In `apps/dashboard/tests/api/admin-overview.test.ts`, add this test inside the existing `describe("GET /api/admin/overview", ...)` block (place it just before the final `void eq` line). It seeds reports at known UTC days via direct Drizzle insert (mirrors the existing "recentReports caps at 10" test):

```ts
  test("volume is a 30-day zero-filled UTC series, newest last, excludes deleted projects", async () => {
    const adminId = await createUser("admin@example.com", "admin")
    const live = await seedProject({
      name: "Live",
      publicKey: "rp_pk_LIVEVOL00000000000000000",
      allowedOrigins: ["http://localhost:4000"],
      createdBy: adminId,
    })
    const dead = await seedProject({
      name: "Dead",
      publicKey: "rp_pk_DEADVOL00000000000000000",
      allowedOrigins: ["http://localhost:4001"],
      createdBy: adminId,
    })

    const DAY = 86_400_000
    const now = Date.now()
    const utcMidnight = (msAgoDays: number) => {
      const d = new Date(now - msAgoDays * DAY)
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12))
    }
    const ctx = {
      pageUrl: "http://localhost:4000/p",
      userAgent: "UA",
      viewport: { w: 1000, h: 800 },
      timestamp: new Date().toISOString(),
    }

    // Live project: 2 reports today, 1 report 3 days ago.
    await db.insert(reports).values([
      { projectId: live, title: "t1", description: null, context: ctx, createdAt: utcMidnight(0) },
      { projectId: live, title: "t2", description: null, context: ctx, createdAt: utcMidnight(0) },
      { projectId: live, title: "t3", description: null, context: ctx, createdAt: utcMidnight(3) },
    ])
    // Dead project: 5 reports today, then soft-delete the project.
    await db.insert(reports).values(
      Array.from({ length: 5 }, (_, i) => ({
        projectId: dead,
        title: `d${i}`,
        description: null,
        context: ctx,
        createdAt: utcMidnight(0),
      })),
    )
    await db.update(projects).set({ deletedAt: new Date() }).where(eq(projects.id, dead))

    const cookie = await signIn("admin@example.com")
    const { status, body } = await apiFetch<AdminOverviewDTO>("/api/admin/overview", {
      headers: { cookie },
    })
    expect(status).toBe(200)

    // Exactly 30 entries, oldest → newest, contiguous UTC days.
    expect(body.volume.length).toBe(30)
    for (let i = 1; i < body.volume.length; i++) {
      const prev = new Date(`${body.volume[i - 1]!.date}T00:00:00Z`).getTime()
      const cur = new Date(`${body.volume[i]!.date}T00:00:00Z`).getTime()
      expect(cur - prev).toBe(DAY)
    }

    const todayStr = new Date(now).toISOString().slice(0, 10)
    const day3Str = new Date(now - 3 * DAY).toISOString().slice(0, 10)
    const byDate = Object.fromEntries(body.volume.map((v) => [v.date, v.count]))

    // Last entry is today; only the 2 live reports count (dead project excluded).
    expect(body.volume[body.volume.length - 1]!.date).toBe(todayStr)
    expect(byDate[todayStr]).toBe(2)
    expect(byDate[day3Str]).toBe(1)
    // A day with no reports is present and zero (pick day 10 ago).
    const day10Str = new Date(now - 10 * DAY).toISOString().slice(0, 10)
    expect(byDate[day10Str]).toBe(0)
  })
```

Add `projects` to the existing schema import at the top of the test file (currently `import { githubIntegrations, projectMembers, reports } from "../../server/db/schema"`):

```ts
import { githubIntegrations, projectMembers, projects, reports } from "../../server/db/schema"
```

(`eq` is already imported in this file.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/dashboard && bun test tests/api/admin-overview.test.ts`
Expected: FAIL — `body.volume` is `undefined` (endpoint doesn't return it yet), so `body.volume.length` throws.

- [ ] **Step 3: Implement the volume query and zero-fill**

In `apps/dashboard/server/api/admin/overview.get.ts`:

a) Add a constant next to `const VOLUME_DAYS = 7`:

```ts
const VOLUME_DAYS = 7
const TREND_DAYS = 30
```

b) Add `trendStart` next to the existing `sevenDaysAgo` line:

```ts
  const sevenDaysAgo = new Date(today.getTime() - (VOLUME_DAYS - 1) * DAY_MS)
  const trendStart = new Date(today.getTime() - (TREND_DAYS - 1) * DAY_MS)
```

c) Add a 10th query as the last element of the `Promise.all([...])` array (after query 9, the `perProjectRows` query — add a comma after its closing `,` and append):

```ts
    // 10. Daily report volume for the last TREND_DAYS, grouped by UTC day.
    //     Counts only non-deleted projects. Sparse — days with zero reports
    //     are absent here and get zero-filled in JS below.
    db
      .select({
        day: sql<string>`to_char(${reports.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`,
        c: count(),
      })
      .from(reports)
      .innerJoin(projects, eq(projects.id, reports.projectId))
      .where(and(isNull(projects.deletedAt), gte(reports.createdAt, trendStart)))
      .groupBy(sql`1`),
```

d) Add `volumeRows` to the destructuring of the `Promise.all` result (append after `perProjectRows`):

```ts
  const [
    totalRows,
    statusCounts,
    priorityCounts,
    last7Rows,
    projectsTotalRows,
    projectsWithGithubRows,
    recentReportRows,
    recentEventRows,
    perProjectRows,
    volumeRows,
  ] = await Promise.all([
```

e) Before the final `return { ... }`, build the zero-filled series:

```ts
  // Zero-fill: every UTC day from trendStart..today inclusive must appear,
  // ordered oldest → newest. `trendStart` is UTC midnight, so slicing the
  // ISO string yields the correct YYYY-MM-DD day key.
  const volumeByDay = new Map(volumeRows.map((r) => [r.day, r.c]))
  const volume = Array.from({ length: TREND_DAYS }, (_, i) => {
    const date = new Date(trendStart.getTime() + i * DAY_MS).toISOString().slice(0, 10)
    return { date, count: volumeByDay.get(date) ?? 0 }
  })
```

f) Add `volume` to the returned object (append after `perProject: ...`):

```ts
    perProject: perProjectRows.map((r) => ({
      id: r.id,
      name: r.name,
      openCount: r.openCount,
      newLast7Count: r.newLast7Count,
      totalCount: r.totalCount,
    })),
    volume,
  }
})
```

(`and`, `count`, `eq`, `gte`, `isNull`, `sql` are all already imported at the top of this file.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/dashboard && bun test tests/api/admin-overview.test.ts`
Expected: PASS — all existing tests plus the new volume test.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/server/api/admin/overview.get.ts apps/dashboard/tests/api/admin-overview.test.ts
git commit -m "feat(dashboard): add 30-day report volume series to admin overview"
```

---

## Task 3: Install the `nuxt-charts` module

**Files:**
- Modify: `apps/dashboard/package.json`
- Modify: `apps/dashboard/nuxt.config.ts`

- [ ] **Step 1: Add the dependency**

Run:

```bash
cd /Users/jiajingteoh/Documents/feedback-tool && bun add --cwd apps/dashboard nuxt-charts@^2.1.4
```

Expected: `apps/dashboard/package.json` gains `"nuxt-charts": "^2.1.4"` under `dependencies` and the lockfile updates.

- [ ] **Step 2: Register the module**

In `apps/dashboard/nuxt.config.ts`, the `modules` array is currently:

```ts
  modules: ["@nuxt/ui", "@nuxt/fonts", "nuxt-security", "@vueuse/nuxt"],
```

Change it to (append `"nuxt-charts"` — touch only this array, leave every other line of the file untouched):

```ts
  modules: ["@nuxt/ui", "@nuxt/fonts", "nuxt-security", "@vueuse/nuxt", "nuxt-charts"],
```

- [ ] **Step 3: Verify the module resolves**

Run: `cd apps/dashboard && bunx nuxi prepare`
Expected: completes without error and regenerates `.nuxt/` types (auto-imports for `AreaChart`/`DonutChart`/`BarChart` become available). If it errors on a peer dep, run `cd /Users/jiajingteoh/Documents/feedback-tool && bun install` then re-run.

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/package.json apps/dashboard/nuxt.config.ts bun.lock
git commit -m "chore(dashboard): add nuxt-charts module"
```

---

## Task 4: Add the Insights chart section to the admin overview page

**Files:**
- Modify: `apps/dashboard/app/pages/admin/index.vue`

No unit test: the dashboard has no Vue component test harness (verified — only API + pure-composable tests exist). Verification is by typecheck/build plus a manual smoke check. The chart data shaping is intentionally simple (computed mappers); the underlying `volume`/`counts`/`perProject` data is already covered by Task 2.

- [ ] **Step 1: Add chart data computeds to the `<script setup>` block**

In `apps/dashboard/app/pages/admin/index.vue`, after the existing `const perProject = computed(...)` / `const projectCount = computed(...)` lines (around line 25-26), add:

```ts
// ── Chart data ───────────────────────────────────────────────────────────
// Theme-aligned hex (charts need concrete colours, not Tailwind tokens).
const C = {
  primary: "#6366f1",
  open: "#3b82f6",
  inProgress: "#f59e0b",
  resolved: "#22c55e",
  closed: "#94a3b8",
} as const

const volume = computed(() => overview.value?.volume ?? [])
const hasVolume = computed(() => volume.value.some((v) => v.count > 0))
const volumeCategories = { count: { name: "Reports", color: C.primary } }
// vue-chrts x-formatter receives the data-array index; map it back to a
// short MM-DD label.
const volumeXFormatter = (i: number): string => {
  const d = volume.value[i]?.date
  return d ? d.slice(5) : ""
}

const statusCounts = computed(() => overview.value?.counts.byStatus)
const STATUS_ORDER = ["open", "in_progress", "resolved", "closed"] as const
const statusData = computed<number[]>(() =>
  STATUS_ORDER.map((s) => statusCounts.value?.[s] ?? 0),
)
const hasStatus = computed(() => statusData.value.some((n) => n > 0))
const statusCategories = {
  Open: { name: "Open", color: C.open },
  "In progress": { name: "In progress", color: C.inProgress },
  Resolved: { name: "Resolved", color: C.resolved },
  Closed: { name: "Closed", color: C.closed },
}

const topProjects = computed(() =>
  perProject.value
    .slice()
    .sort((a, b) => b.openCount - a.openCount)
    .slice(0, 8)
    .map((p) => ({ project: p.name, open: p.openCount })),
)
const hasTopProjects = computed(() => topProjects.value.some((p) => p.open > 0))
const topProjectsCategories = { open: { name: "Open reports", color: C.open } }
const topProjectsXFormatter = (i: number): string => topProjects.value[i]?.project ?? ""
```

- [ ] **Step 2: Add the Insights section to the template**

In the same file, insert this block **between** the closing `</div>` of the "Metric tiles" grid and the opening of the "Two-column: recent reports + activity" `<div class="grid grid-cols-1 lg:grid-cols-2 gap-4">` (i.e. immediately after line 129's closing `</div>` and the `<!-- Two-column ... -->` comment, before that grid):

```vue
    <!-- Insights -->
    <div v-if="projectCount > 0" class="space-y-4">
      <div class="rounded-xl border border-default bg-default">
        <div class="px-5 py-4 border-b border-default">
          <h2 class="text-sm font-semibold text-default tracking-tight">Reports over time</h2>
          <p class="mt-0.5 text-sm text-muted">Reports received per day, last 30 days.</p>
        </div>
        <div class="p-5">
          <AreaChart
            v-if="hasVolume"
            :data="volume"
            :height="240"
            :categories="volumeCategories"
            :x-formatter="volumeXFormatter"
            :x-num-ticks="6"
          />
          <div v-else class="text-sm text-muted py-10 text-center">No reports yet.</div>
        </div>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div class="rounded-xl border border-default bg-default">
          <div class="px-5 py-4 border-b border-default">
            <h2 class="text-sm font-semibold text-default tracking-tight">Status distribution</h2>
          </div>
          <div class="p-5 flex justify-center">
            <DonutChart
              v-if="hasStatus"
              :data="statusData"
              :height="240"
              :categories="statusCategories"
              :radius="4"
              :arc-width="24"
            />
            <div v-else class="text-sm text-muted py-10 text-center">No reports yet.</div>
          </div>
        </div>

        <div class="rounded-xl border border-default bg-default">
          <div class="px-5 py-4 border-b border-default">
            <h2 class="text-sm font-semibold text-default tracking-tight">
              Top projects by open reports
            </h2>
          </div>
          <div class="p-5">
            <BarChart
              v-if="hasTopProjects"
              :data="topProjects"
              :height="240"
              :categories="topProjectsCategories"
              :y-axis="['open']"
              orientation="horizontal"
              :x-formatter="topProjectsXFormatter"
            />
            <div v-else class="text-sm text-muted py-10 text-center">
              No open reports yet.
            </div>
          </div>
        </div>
      </div>
    </div>
```

- [ ] **Step 3: Typecheck + build**

Run: `cd apps/dashboard && bunx nuxi typecheck`
Expected: no type errors in `pages/admin/index.vue`.

Run: `cd /Users/jiajingteoh/Documents/feedback-tool && bun run build`
Expected: dashboard build succeeds (chart components resolve via the module's auto-imports).

- [ ] **Step 4: Manual smoke check**

Run: `cd /Users/jiajingteoh/Documents/feedback-tool && bun run dev:docker` then `bun run dev`, sign in as an install admin, open `/admin`. Confirm: the trend area chart, status donut, and top-projects horizontal bar render with data; empty states show when a series is empty. Stop the dev server when done.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/app/pages/admin/index.vue
git commit -m "feat(dashboard): add insight charts to admin overview"
```

---

## Task 5: Bug B — deleted project no longer lingers in the list

**Files:**
- Modify: `apps/dashboard/app/pages/index.vue:32-34`
- Modify: `apps/dashboard/app/pages/projects/[id]/settings.vue:149-169`
- Test: `apps/dashboard/tests/api/admin-overview.test.ts` (add a focused `/api/projects` regression test — same file already wires Postgres + helpers)

The server already excludes soft-deleted projects from `GET /api/projects` (verified: `isNull(projects.deletedAt)` for both admin and member branches). The bug is purely Nuxt client-side: `useApi("/api/projects")` payload is cached and not refetched on client navigation back to `/`. We add a regression test guarding the server contract the fix relies on, then fix the client cache.

- [ ] **Step 1: Write the failing/guard test**

In `apps/dashboard/tests/api/admin-overview.test.ts`, add this test inside the `describe` block (before the final `void eq`):

```ts
  test("GET /api/projects excludes soft-deleted projects", async () => {
    const adminId = await createUser("padmin@example.com", "admin")
    const keep = await seedProject({
      name: "Keep",
      publicKey: "rp_pk_KEEPPRJ00000000000000000",
      allowedOrigins: ["http://localhost:4000"],
      createdBy: adminId,
    })
    const gone = await seedProject({
      name: "Gone",
      publicKey: "rp_pk_GONEPRJ00000000000000000",
      allowedOrigins: ["http://localhost:4001"],
      createdBy: adminId,
    })
    await db.update(projects).set({ deletedAt: new Date() }).where(eq(projects.id, gone))

    const cookie = await signIn("padmin@example.com")
    const { status, body } = await apiFetch<Array<{ id: string }>>("/api/projects", {
      headers: { cookie },
    })
    expect(status).toBe(200)
    const ids = body.map((p) => p.id)
    expect(ids).toContain(keep)
    expect(ids).not.toContain(gone)
  })
```

- [ ] **Step 2: Run test to verify it passes (guard, not red)**

Run: `cd apps/dashboard && bun test tests/api/admin-overview.test.ts`
Expected: PASS — this guards the server behaviour the client fix depends on. (It is green from the start because the server is already correct; it documents and locks the contract.)

- [ ] **Step 3: Give the projects list fetch an explicit cache key**

In `apps/dashboard/app/pages/index.vue`, the fetch is currently:

```ts
const {
  data: projects,
  pending,
  refresh,
} = await useApi<ProjectDTO[]>("/api/projects", {
  default: () => [],
})
```

Change it to add an explicit `key` so the cache entry can be cleared deterministically from another page:

```ts
const {
  data: projects,
  pending,
  refresh,
} = await useApi<ProjectDTO[]>("/api/projects", {
  key: "projects-list",
  default: () => [],
})
```

- [ ] **Step 4: Invalidate that key after deleting a project**

In `apps/dashboard/app/pages/projects/[id]/settings.vue`, the `confirmDelete()` function currently does:

```ts
    await $fetch(`/api/projects/${projectId.value}`, {
      method: "DELETE",
      credentials: "include",
    })
    toast.add({ title: "Project deleted", color: "success", icon: "i-heroicons-check-circle" })
    router.push("/")
```

Change the success path to clear the cached projects list before navigating, so the list page refetches fresh on mount:

```ts
    await $fetch(`/api/projects/${projectId.value}`, {
      method: "DELETE",
      credentials: "include",
    })
    toast.add({ title: "Project deleted", color: "success", icon: "i-heroicons-check-circle" })
    // The projects list (`/`) caches `/api/projects` under this key. Without
    // clearing it, client-side nav back to `/` shows the deleted project
    // until a hard refresh.
    clearNuxtData("projects-list")
    router.push("/")
```

`clearNuxtData` is a Nuxt auto-imported composable — no import statement needed.

- [ ] **Step 5: Typecheck**

Run: `cd apps/dashboard && bunx nuxi typecheck`
Expected: no new type errors in `pages/index.vue` or `pages/projects/[id]/settings.vue`.

- [ ] **Step 6: Manual smoke check**

With the dev server running, as a project owner: open a project's Settings, delete it, confirm you land on `/` and the deleted project is **absent** without a manual refresh.

- [ ] **Step 7: Commit**

```bash
git add apps/dashboard/app/pages/index.vue apps/dashboard/app/pages/projects/[id]/settings.vue apps/dashboard/tests/api/admin-overview.test.ts
git commit -m "fix(dashboard): refetch projects list after deleting a project"
```

---

## Task 6: Bug C — extract a pure `pollUntil` helper

**Files:**
- Create: `apps/dashboard/app/composables/use-poll-until.ts`
- Test: `apps/dashboard/tests/composables/use-poll-until.test.ts` (create)

Mirrors the existing pure-composable pattern (`app/composables/use-safe-href.ts` + `tests/composables/use-safe-href.test.ts`). The helper is framework-free so it is unit-testable with `bun test` without a Vue harness. `sleep` is injectable so tests don't actually wait.

- [ ] **Step 1: Write the failing test**

Create `apps/dashboard/tests/composables/use-poll-until.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { pollUntil } from "../../app/composables/use-poll-until"

const noSleep = async (): Promise<void> => {}

describe("pollUntil", () => {
  test("returns true as soon as the predicate is satisfied", async () => {
    let calls = 0
    const fetcher = async () => ++calls
    const ok = await pollUntil(fetcher, (n) => n >= 3, {
      attempts: 10,
      intervalMs: 1,
      sleep: noSleep,
    })
    expect(ok).toBe(true)
    expect(calls).toBe(3)
  })

  test("returns false after exhausting attempts without satisfying the predicate", async () => {
    let calls = 0
    const fetcher = async () => ++calls
    const ok = await pollUntil(fetcher, () => false, {
      attempts: 4,
      intervalMs: 1,
      sleep: noSleep,
    })
    expect(ok).toBe(false)
    expect(calls).toBe(4)
  })

  test("returns true on the first attempt when already satisfied", async () => {
    let calls = 0
    const fetcher = async () => ++calls
    const ok = await pollUntil(fetcher, () => true, {
      attempts: 5,
      intervalMs: 1,
      sleep: noSleep,
    })
    expect(ok).toBe(true)
    expect(calls).toBe(1)
  })

  test("does not sleep after the final attempt", async () => {
    let sleeps = 0
    const sleep = async () => {
      sleeps++
    }
    await pollUntil(async () => 0, () => false, { attempts: 3, intervalMs: 1, sleep })
    // 3 attempts → at most 2 inter-attempt sleeps.
    expect(sleeps).toBe(2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/dashboard && bun test tests/composables/use-poll-until.test.ts`
Expected: FAIL — module `../../app/composables/use-poll-until` does not exist.

- [ ] **Step 3: Implement the helper**

Create `apps/dashboard/app/composables/use-poll-until.ts`:

```ts
/**
 * Bounded async poll. Calls `fetcher` up to `attempts` times, returning
 * `true` as soon as `done(result)` is truthy, or `false` once attempts are
 * exhausted. Sleeps `intervalMs` between attempts (never after the last).
 *
 * `sleep` is injectable so callers/tests can substitute timing. Default uses
 * a real timer.
 *
 * Used by the triage sidebar: GitHub-issue creation is processed by an
 * async in-process worker, so the report row gains its `githubIssueNumber`
 * a beat after the POST resolves. Poll until it lands before refetching.
 */
export interface PollOptions {
  attempts: number
  intervalMs: number
  sleep?: (ms: number) => Promise<void>
}

const realSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

export async function pollUntil<T>(
  fetcher: () => Promise<T>,
  done: (value: T) => boolean,
  opts: PollOptions,
): Promise<boolean> {
  const sleep = opts.sleep ?? realSleep
  for (let attempt = 1; attempt <= opts.attempts; attempt++) {
    const value = await fetcher()
    if (done(value)) return true
    if (attempt < opts.attempts) await sleep(opts.intervalMs)
  }
  return false
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/dashboard && bun test tests/composables/use-poll-until.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/app/composables/use-poll-until.ts apps/dashboard/tests/composables/use-poll-until.test.ts
git commit -m "feat(dashboard): add pure pollUntil helper"
```

---

## Task 7: Bug C — wire `pollUntil` into the triage sidebar `createIssue`

**Files:**
- Modify: `apps/dashboard/app/components/report-drawer/triage-footer.vue:56-75`

`createIssue()` currently emits `patched` immediately after the POST, racing the async sync worker. Replace the body so it polls the report endpoint until `githubIssueNumber` lands (or times out), keeping the button in its loading state throughout.

- [ ] **Step 1: Update `createIssue()`**

In `apps/dashboard/app/components/report-drawer/triage-footer.vue`, replace the entire `createIssue` function (lines 56-75):

```ts
async function createIssue() {
  ghSubmitting.value = true
  try {
    await $fetch(`/api/projects/${props.projectId}/reports/${props.report.id}/github-sync`, {
      method: "POST",
      credentials: "include",
    })
    // github-sync is async: it enqueues an in-process worker and returns
    // immediately. Poll the report until the worker links the issue, then
    // refetch once so the parent renders consistent data. ~12s ceiling.
    const linked = await pollUntil(
      () =>
        $fetch<ReportDetailDTO>(
          `/api/projects/${props.projectId}/reports/${props.report.id}`,
          { credentials: "include" },
        ),
      (r) => r.githubIssueNumber !== null,
      { attempts: 12, intervalMs: 1000 },
    )
    emit("patched")
    if (linked) {
      toast.add({
        title: "GitHub issue created",
        color: "success",
        icon: "i-heroicons-check-circle",
      })
    } else {
      toast.add({
        title: "Issue is being created",
        description: "It'll appear here shortly.",
        color: "info",
        icon: "i-heroicons-information-circle",
      })
    }
  } catch (err) {
    toast.add({
      title: "Could not create GitHub issue",
      description: err instanceof Error ? err.message : undefined,
      color: "error",
      icon: "i-heroicons-exclamation-triangle",
    })
  } finally {
    ghSubmitting.value = false
  }
}
```

- [ ] **Step 2: Add the imports**

In the same file's `<script setup>`, the type import block currently is:

```ts
import type {
  GithubConfigDTO,
  ReportPriority,
  ReportStatus,
  ReportSummaryDTO,
} from "@reprojs/shared"
```

Add `ReportDetailDTO`:

```ts
import type {
  GithubConfigDTO,
  ReportDetailDTO,
  ReportPriority,
  ReportStatus,
  ReportSummaryDTO,
} from "@reprojs/shared"
```

`pollUntil` is auto-imported by Nuxt from `app/composables/` — no import statement needed (consistent with how `safeHref` is used in this same file via `import { safeHref } from "~/composables/use-safe-href"` — note: that one IS explicitly imported). To match the file's existing convention, add an explicit import next to the existing composable import:

```ts
import { safeHref } from "~/composables/use-safe-href"
import { pollUntil } from "~/composables/use-poll-until"
```

- [ ] **Step 3: Typecheck**

Run: `cd apps/dashboard && bunx nuxi typecheck`
Expected: no type errors in `triage-footer.vue` (note `ReportDetailDTO` has `githubIssueNumber: number | null`, so the predicate typechecks).

- [ ] **Step 4: Manual smoke check**

With the dev server running and a project that has a connected GitHub integration: open a report not yet linked, click "Create GitHub issue". Confirm the button stays in its loading state for a beat, then the GitHub section flips to the linked-issue view **without** a manual page refresh, and a success toast shows.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/app/components/report-drawer/triage-footer.vue
git commit -m "fix(dashboard): poll for github issue link before refetching in triage sidebar"
```

---

## Task 8: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `cd /Users/jiajingteoh/Documents/feedback-tool && bun run dev:docker && bun test`
Expected: all tests pass (Postgres-backed integration tests need the Docker DB up).

- [ ] **Step 2: Lint + format check**

Run: `cd /Users/jiajingteoh/Documents/feedback-tool && bun run check`
Expected: `oxfmt --check` clean and `oxlint` reports **0 errors** (pre-existing warnings are acceptable — do not "fix" unrelated files).

- [ ] **Step 3: Production build**

Run: `cd /Users/jiajingteoh/Documents/feedback-tool && bun run build`
Expected: dashboard builds successfully.

- [ ] **Step 4: Final commit (only if Step 2 auto-formatted anything)**

```bash
git add -A
git commit -m "chore: formatting after admin charts + refetch fixes"
```

---

## Self-Review Notes

- **Spec coverage:** Part A backend → Tasks 1-2; Part A frontend (module + charts) → Tasks 3-4; Part B → Task 5; Part C → Tasks 6-7; testing strategy → tests in Tasks 1, 2, 5, 6 + verification Task 8. All spec sections mapped.
- **No Vue component tests:** confirmed the dashboard has no Vue test harness; Part C's testable logic is extracted into the pure `pollUntil` helper (Task 6) rather than introducing a new harness (YAGNI). Charts (Task 4) are verified by typecheck/build/manual — the data shaping is trivial computeds over data already covered by Task 2.
- **Type consistency:** `volume: { date: string; count: number }[]` defined in Task 1 is consumed identically in Task 2 (server) and Task 4 (`volume`/`hasVolume`). `pollUntil(fetcher, done, opts)` signature defined in Task 6 is called with that exact shape in Task 7. `ReportDetailDTO.githubIssueNumber` is `number | null` (verified) — predicate `r.githubIssueNumber !== null` is correct.
- **`nuxt-charts` prop API** verified against the official docs: `AreaChart` (`data`/`height`/`categories`/`x-formatter`, formatter receives the data index), `DonutChart` (`data: number[]`/`categories` keyed by display string/`radius`/`arc-width`), `BarChart` (`data`/`categories`/`y-axis`/`orientation="horizontal"`/`x-formatter`).
