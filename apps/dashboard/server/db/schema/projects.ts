import { sql } from "drizzle-orm"
import {
  boolean,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core"

export const projects = pgTable(
  "projects",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    name: varchar("name", { length: 120 }).notNull(),
    createdBy: text("created_by").notNull(),
    publicKey: text("public_key"),
    allowedOrigins: text("allowed_origins")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    dailyReportCap: integer("daily_report_cap").notNull().default(1000),
    replayEnabled: boolean("replay_enabled").notNull().default(true),
    shareLinksEnabled: boolean("share_links_enabled").notNull().default(true),
    shareRetentionDays: integer("share_retention_days").notNull().default(30),
    publicKeyRegeneratedAt: timestamp("public_key_regenerated_at").defaultNow().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    deletedAt: timestamp("deleted_at"),
  },
  (table) => ({
    publicKeyUnique: uniqueIndex("projects_public_key_idx").on(table.publicKey),
  }),
)

export type Project = typeof projects.$inferSelect
export type NewProject = typeof projects.$inferInsert
