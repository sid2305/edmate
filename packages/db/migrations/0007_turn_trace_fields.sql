-- Task 3.8: turn_traces gains the rest of the TurnTrace contract (turn id, versions, intent, move,
-- guards, usage) and one trace per turn (a worker retry can't write a second one). Additive.
-- The new columns are NOT NULL with no default, so existing rows can't be filled truthfully:
-- the migration stops if the table has any, so an operator decides what to do with them.
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM "turn_traces") THEN
		RAISE EXCEPTION 'turn_traces has rows written before the full TurnTrace was stored; archive or delete them before this migration';
	END IF;
END $$;--> statement-breakpoint
ALTER TABLE "turn_traces" ADD COLUMN "turn_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "turn_traces" ADD COLUMN "agent_version" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "turn_traces" ADD COLUMN "package_version" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "turn_traces" ADD COLUMN "intent" text NOT NULL;--> statement-breakpoint
ALTER TABLE "turn_traces" ADD COLUMN "move" text NOT NULL;--> statement-breakpoint
ALTER TABLE "turn_traces" ADD COLUMN "guards" jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "turn_traces" ADD COLUMN "usage" jsonb NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "turn_traces_turn_id_key" ON "turn_traces" USING btree ("turn_id");