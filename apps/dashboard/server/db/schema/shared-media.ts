import { index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"
import { projects } from "./projects"

export const sharedMedia = pgTable(
  "shared_media",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    kind: text("kind", { enum: ["video"] }).notNull(),
    mime: text("mime").notNull(),
    storageKey: text("storage_key").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    durationMs: integer("duration_ms"),
    trimStartMs: integer("trim_start_ms"),
    trimEndMs: integer("trim_end_ms"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    expiresAt: timestamp("expires_at").notNull(),
    revokedAt: timestamp("revoked_at"),
  },
  (table) => ({
    projectIdx: index("shared_media_project_idx").on(table.projectId),
    expiresIdx: index("shared_media_expires_idx").on(table.expiresAt),
  }),
)

export type SharedMedia = typeof sharedMedia.$inferSelect
export type NewSharedMedia = typeof sharedMedia.$inferInsert
