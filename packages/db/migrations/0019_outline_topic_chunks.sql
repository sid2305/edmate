CREATE TABLE "topic_chunks" (
	"id" text PRIMARY KEY NOT NULL,
	"teacher_id" text NOT NULL,
	"topic_id" text NOT NULL,
	"chunk_id" text NOT NULL,
	"order" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "topic_chunks" ADD CONSTRAINT "topic_chunks_teacher_id_users_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_chunks" ADD CONSTRAINT "topic_chunks_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_chunks" ADD CONSTRAINT "topic_chunks_chunk_id_chunks_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "public"."chunks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "topic_chunks_teacher_id_topic_id_idx" ON "topic_chunks" USING btree ("teacher_id","topic_id");--> statement-breakpoint
CREATE INDEX "topic_chunks_chunk_id_idx" ON "topic_chunks" USING btree ("chunk_id");--> statement-breakpoint
CREATE UNIQUE INDEX "topic_chunks_topic_id_chunk_id_key" ON "topic_chunks" USING btree ("topic_id","chunk_id");