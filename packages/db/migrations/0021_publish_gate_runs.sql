-- Task 8.7: publish-gate runs live in eval_runs (suite 'gate'). Additive only: new nullable
-- columns, a foreign key to agents, a status check, one open run per agent (partial unique index)
-- and an (agent_id, created_at) index. No drop, no rewrite, no data change.
ALTER TABLE "eval_runs" ADD COLUMN "agent_id" text;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "status" text;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "changes" text[];--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "basis" jsonb;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "summary" jsonb;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "scorecard" jsonb;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "published_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "eval_runs_agent_id_created_at_idx" ON "eval_runs" USING btree ("agent_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "eval_runs_agent_id_open_key" ON "eval_runs" USING btree ("agent_id") WHERE "eval_runs"."status" in ('queued', 'running');--> statement-breakpoint
ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_status_check" CHECK ("eval_runs"."status" is null or "eval_runs"."status" in ('queued', 'running', 'passed', 'failed', 'error'));