import { sql } from "drizzle-orm"
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core"

// Discriminated union carried by each sync-job row. null/undefined = reconcile (backward compat).
export type SyncJobPayload =
  | { kind: "reconcile" }
  | { kind: "comment_upsert"; commentId: string }
  | { kind: "comment_delete"; commentId: string; githubCommentId: number }
import { projects } from "./projects"
import { reports } from "./reports"

export const githubIntegrations = pgTable(
  "github_integrations",
  {
    projectId: uuid("project_id")
      .primaryKey()
      .references(() => projects.id, { onDelete: "cascade" }),
    installationId: bigint("installation_id", { mode: "number" }).notNull(),
    repoOwner: text("repo_owner").notNull().default(""),
    repoName: text("repo_name").notNull().default(""),
    defaultLabels: text("default_labels")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    defaultAssignees: text("default_assignees")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    status: text("status", { enum: ["connected", "disconnected"] })
      .notNull()
      .default("connected"),
    lastError: text("last_error"),
    connectedBy: text("connected_by"),
    connectedAt: timestamp("connected_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    autoCreateOnIntake: boolean("auto_create_on_intake").default(false).notNull(),
    pushOnEdit: boolean("push_on_edit").default(false).notNull(),
    labelsLastSyncedAt: timestamp("labels_last_synced_at", { withTimezone: true, mode: "date" }),
    milestonesLastSyncedAt: timestamp("milestones_last_synced_at", {
      withTimezone: true,
      mode: "date",
    }),
    membersLastSyncedAt: timestamp("members_last_synced_at", { withTimezone: true, mode: "date" }),
  },
  (table) => ({
    installationIdIdx: index("github_integrations_installation_id_idx").on(table.installationId),
  }),
)

// Composite PK `(reportId, signature)` — without the signature column,
// every enqueue call for the same report collides on the same row, so a
// pending `comment_upsert` would clobber a pending `reconcile` (and vice
// versa). Signature differentiates the unit of work:
//   - `reconcile`                   — whole-report snapshot reconcile
//   - `comment_upsert:<commentId>`  — per-comment create/edit
//   - `comment_delete:<commentId>`  — per-comment delete
// Default of `'reconcile'` keeps older test fixtures that insert `{ reportId }`
// working; production enqueue paths always pass an explicit signature.
export const reportSyncJobs = pgTable(
  "report_sync_jobs",
  {
    reportId: uuid("report_id")
      .notNull()
      .references(() => reports.id, { onDelete: "cascade" }),
    signature: text("signature").notNull().default("reconcile"),
    state: text("state", { enum: ["pending", "syncing", "failed"] })
      .notNull()
      .default("pending"),
    // Set when an enqueue lands while the row is `syncing`. The worker must
    // not be reset to `pending` mid-flight (it would delete the row on
    // completion, or a second worker would run a concurrent reconcile and
    // create a duplicate GitHub issue); instead the runner requeues the job
    // once after its current pass succeeds.
    rerunRequested: boolean("rerun_requested").notNull().default(false),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    nextAttemptAt: timestamp("next_attempt_at").defaultNow().notNull(),
    payload: jsonb("payload").$type<SyncJobPayload>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.reportId, table.signature] }),
    pendingIdx: index("report_sync_jobs_pending_idx")
      .on(table.nextAttemptAt)
      .where(sql`${table.state} = 'pending'`),
    failedIdx: index("report_sync_jobs_failed_idx")
      .on(table.state)
      .where(sql`${table.state} = 'failed'`),
  }),
)

export type GithubIntegration = typeof githubIntegrations.$inferSelect
export type NewGithubIntegration = typeof githubIntegrations.$inferInsert
export type ReportSyncJob = typeof reportSyncJobs.$inferSelect
export type NewReportSyncJob = typeof reportSyncJobs.$inferInsert
