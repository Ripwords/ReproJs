CREATE TABLE "shared_media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"token" text NOT NULL,
	"kind" text NOT NULL,
	"mime" text NOT NULL,
	"storage_key" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"duration_ms" integer,
	"trim_start_ms" integer,
	"trim_end_ms" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"revoked_at" timestamp,
	CONSTRAINT "shared_media_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "report_attachments" DROP CONSTRAINT "report_attachments_kind_check";--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "share_links_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "share_retention_days" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "report_attachments" ADD COLUMN "duration_ms" integer;--> statement-breakpoint
ALTER TABLE "report_attachments" ADD COLUMN "trim_start_ms" integer;--> statement-breakpoint
ALTER TABLE "report_attachments" ADD COLUMN "trim_end_ms" integer;--> statement-breakpoint
ALTER TABLE "shared_media" ADD CONSTRAINT "shared_media_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "shared_media_project_idx" ON "shared_media" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "shared_media_expires_idx" ON "shared_media" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "report_attachments" ADD CONSTRAINT "report_attachments_kind_check" CHECK ("report_attachments"."kind" IN ('screenshot', 'annotated-screenshot', 'replay', 'logs', 'user-file', 'media'));