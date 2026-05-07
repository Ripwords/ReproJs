import { sql } from "drizzle-orm"
import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"
import { projects } from "./projects"
import { reports } from "./reports"

export const reportEvents = pgTable(
  "report_events",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    reportId: uuid("report_id")
      .notNull()
      .references(() => reports.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    actorId: text("actor_id"),
    actorClientId: text("actor_client_id"),
    kind: text("kind", {
      enum: [
        "status_changed",
        "assignee_changed",
        "priority_changed",
        "tag_added",
        "tag_removed",
        "github_linked",
        "github_unlinked",
        "assignee_added",
        "assignee_removed",
        "milestone_changed",
        "comment_added",
        "comment_edited",
        "comment_deleted",
        "github_labels_updated",
      ],
    }).notNull(),
    payload: jsonb("payload")
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    reportCreatedIdx: index("report_events_report_created_idx").on(
      table.reportId,
      sql`${table.createdAt} DESC`,
    ),
    projectCreatedAtIdx: index("report_events_project_created_at_idx").on(
      table.projectId,
      sql`${table.createdAt} DESC`,
    ),
  }),
)

export type ReportEvent = typeof reportEvents.$inferSelect
export type NewReportEvent = typeof reportEvents.$inferInsert
export type ReportEventKind = NonNullable<ReportEvent["kind"]>
