DROP INDEX "class_questions_live_class_id_idx";--> statement-breakpoint
DROP INDEX "safety_alerts_open_created_at_id_idx";--> statement-breakpoint
CREATE INDEX "class_questions_live_class_id_created_at_id_idx" ON "class_questions" USING btree ("live_class_id","created_at","id");--> statement-breakpoint
CREATE INDEX "safety_alerts_open_created_at_created_id_idx" ON "safety_alerts" USING btree (("acknowledged_at" is not null),("escalated_at" is null),"created_at","id") WHERE "safety_alerts"."acknowledged_at" is null;--> statement-breakpoint
CREATE INDEX "safety_alerts_acknowledged_by_idx" ON "safety_alerts" USING btree ("acknowledged_by") WHERE "safety_alerts"."acknowledged_by" is not null;