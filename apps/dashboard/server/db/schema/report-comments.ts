import { pgTable, uuid, text, timestamp, pgEnum, bigint, index } from "drizzle-orm/pg-core"
import { reports } from "./reports"
import { user } from "./auth-schema"

export const reportCommentSources = pgEnum("report_comment_source", ["dashboard", "github"])

export const reportComments = pgTable(
  "report_comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reportId: uuid("report_id")
      .notNull()
      .references(() => reports.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    githubLogin: text("github_login"),
    actorClientId: text("actor_client_id"),
    body: text("body").notNull(),
    githubCommentId: bigint("github_comment_id", { mode: "number" }).unique(),
    source: reportCommentSources("source").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [index("report_comments_report_created_idx").on(table.reportId, table.createdAt)],
)
