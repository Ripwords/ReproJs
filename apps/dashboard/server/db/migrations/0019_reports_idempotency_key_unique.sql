-- 0019_reports_idempotency_key_unique.sql
-- The (project_id, idempotency_key) index was non-unique, so two retries
-- racing on the same Idempotency-Key could both insert. Before making it
-- UNIQUE, release the key on any duplicates already present (keep the
-- oldest row's key; the later rows stay as reports but drop their key so
-- the index can be built).
UPDATE "reports" r
SET "idempotency_key" = NULL
FROM (
  SELECT "id",
         row_number() OVER (
           PARTITION BY "project_id", "idempotency_key"
           ORDER BY "created_at", "id"
         ) AS rn
  FROM "reports"
  WHERE "idempotency_key" IS NOT NULL
) d
WHERE r."id" = d."id" AND d.rn > 1;--> statement-breakpoint
DROP INDEX "reports_project_idempotency_key_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "reports_project_idempotency_key_idx" ON "reports" USING btree ("project_id","idempotency_key") WHERE "reports"."idempotency_key" IS NOT NULL;
