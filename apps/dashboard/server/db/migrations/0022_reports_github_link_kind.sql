-- 0022_reports_github_link_kind.sql
-- Attach reports to existing GitHub issues. `github_link_kind` records whether
-- Repro created the issue ('created': fields are pushed to it) or the report
-- was attached to a pre-existing one ('attached': the report follows the
-- issue, only comments are pushed). `github_attach_comment_id` makes the
-- one-time report-body comment idempotent. `reporter_issue_hint` is the issue
-- number the reporter typed into the widget; it never writes to GitHub.
ALTER TABLE "reports" ADD COLUMN "github_link_kind" text;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "github_attach_comment_id" bigint;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "reporter_issue_hint" integer;--> statement-breakpoint
-- Every issue linked before this migration was created by Repro.
UPDATE "reports" SET "github_link_kind" = 'created' WHERE "github_issue_number" IS NOT NULL;
