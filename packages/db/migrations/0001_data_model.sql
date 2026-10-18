CREATE TYPE "public"."agent_status" AS ENUM('draft', 'live', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."chunk_kind" AS ENUM('material', 'transcript', 'teacher_note');--> statement-breakpoint
CREATE TYPE "public"."evidence_source" AS ENUM('check', 'practice', 'rubric');--> statement-breakpoint
CREATE TYPE "public"."ledger_direction" AS ENUM('debit', 'credit');--> statement-breakpoint
CREATE TYPE "public"."message_role" AS ENUM('student', 'agent', 'teacher');--> statement-breakpoint
CREATE TYPE "public"."model_tier" AS ENUM('small', 'main');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('trial', 'active', 'past_due', 'paused', 'ended');--> statement-breakpoint
CREATE TYPE "public"."teacher_question_status" AS ENUM('open', 'answered', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('student', 'teacher', 'staff');--> statement-breakpoint
CREATE TABLE "agent_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"teacher_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"version" integer NOT NULL,
	"config" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" text PRIMARY KEY NOT NULL,
	"teacher_id" text NOT NULL,
	"status" "agent_status" DEFAULT 'draft' NOT NULL,
	"live_version" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"target" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chunks" (
	"id" text PRIMARY KEY NOT NULL,
	"teacher_id" text NOT NULL,
	"document_id" text NOT NULL,
	"module_id" text NOT NULL,
	"kind" "chunk_kind" NOT NULL,
	"text" text NOT NULL,
	"source_title" text NOT NULL,
	"locator" text NOT NULL,
	"embedding" vector,
	"search" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', "text")) STORED NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "class_questions" (
	"id" text PRIMARY KEY NOT NULL,
	"live_class_id" text NOT NULL,
	"text" text NOT NULL,
	"order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consents" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"version" text NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "corrections" (
	"id" text PRIMARY KEY NOT NULL,
	"teacher_id" text NOT NULL,
	"module_id" text,
	"question" text NOT NULL,
	"bad_answer" text NOT NULL,
	"corrected_answer" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "courses" (
	"id" text PRIMARY KEY NOT NULL,
	"teacher_id" text NOT NULL,
	"title" text NOT NULL,
	"order" integer NOT NULL,
	"outline_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" text PRIMARY KEY NOT NULL,
	"teacher_id" text NOT NULL,
	"module_id" text NOT NULL,
	"kind" "chunk_kind" NOT NULL,
	"source_title" text NOT NULL,
	"storage_key" text,
	"rights_declared_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eval_results" (
	"id" text PRIMARY KEY NOT NULL,
	"eval_run_id" text NOT NULL,
	"case_id" text NOT NULL,
	"passed" boolean NOT NULL,
	"details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eval_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"teacher_id" text NOT NULL,
	"agent_version_id" text NOT NULL,
	"suite" text NOT NULL,
	"model" text NOT NULL,
	"pass_rate" double precision,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidence_events" (
	"id" text PRIMARY KEY NOT NULL,
	"student_id" text NOT NULL,
	"teacher_id" text NOT NULL,
	"topic_id" text NOT NULL,
	"correct" boolean NOT NULL,
	"source" "evidence_source" NOT NULL,
	"weight" double precision DEFAULT 1 NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "insights" (
	"id" text PRIMARY KEY NOT NULL,
	"teacher_id" text NOT NULL,
	"week" date NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" text PRIMARY KEY NOT NULL,
	"teacher_id" text NOT NULL,
	"student_id" text NOT NULL,
	"payment_id" text,
	"number" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"market" text NOT NULL,
	"provider" text NOT NULL,
	"provider_ref" text,
	"issued_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_amount_minor_check" CHECK ("invoices"."amount_minor" >= 0),
	CONSTRAINT "invoices_currency_check" CHECK ("invoices"."currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "learner_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"student_id" text NOT NULL,
	"teacher_id" text NOT NULL,
	"lang" text NOT NULL,
	"mastery" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"mistakes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_summary" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"transaction_id" text NOT NULL,
	"account" text NOT NULL,
	"direction" "ledger_direction" NOT NULL,
	"teacher_id" text,
	"payment_id" text,
	"payout_id" text,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"market" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_entries_amount_minor_check" CHECK ("ledger_entries"."amount_minor" > 0),
	CONSTRAINT "ledger_entries_currency_check" CHECK ("ledger_entries"."currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "live_classes" (
	"id" text PRIMARY KEY NOT NULL,
	"teacher_id" text NOT NULL,
	"package_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"title" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"link" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"role" "message_role" NOT NULL,
	"text" text NOT NULL,
	"sources" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "modules" (
	"id" text PRIMARY KEY NOT NULL,
	"teacher_id" text NOT NULL,
	"course_id" text NOT NULL,
	"title" text NOT NULL,
	"order" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "package_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"teacher_id" text NOT NULL,
	"package_id" text NOT NULL,
	"version" integer NOT NULL,
	"config" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "packages" (
	"id" text PRIMARY KEY NOT NULL,
	"teacher_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"name" text NOT NULL,
	"live_version" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" text PRIMARY KEY NOT NULL,
	"teacher_id" text NOT NULL,
	"student_id" text NOT NULL,
	"subscription_id" text,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"market" text NOT NULL,
	"provider" text NOT NULL,
	"provider_ref" text,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_amount_minor_check" CHECK ("payments"."amount_minor" >= 0),
	CONSTRAINT "payments_currency_check" CHECK ("payments"."currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "payouts" (
	"id" text PRIMARY KEY NOT NULL,
	"teacher_id" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"market" text NOT NULL,
	"provider" text NOT NULL,
	"provider_ref" text,
	"status" text NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payouts_amount_minor_check" CHECK ("payouts"."amount_minor" >= 0),
	CONSTRAINT "payouts_currency_check" CHECK ("payouts"."currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" text PRIMARY KEY NOT NULL,
	"target" text NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"staff_actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reporter_id" text
);
--> statement-breakpoint
CREATE TABLE "safety_events" (
	"id" text PRIMARY KEY NOT NULL,
	"target" text NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"staff_actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"student_id" text NOT NULL,
	"teacher_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"agent_version" integer NOT NULL,
	"help_state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"summary" text,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "style_cards" (
	"id" text PRIMARY KEY NOT NULL,
	"teacher_id" text NOT NULL,
	"version" integer NOT NULL,
	"text" text NOT NULL,
	"mistake_tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"student_id" text NOT NULL,
	"teacher_id" text NOT NULL,
	"package_version_id" text NOT NULL,
	"status" "subscription_status" NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"provider_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "takedowns" (
	"id" text PRIMARY KEY NOT NULL,
	"target" text NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"staff_actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "teacher_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"slug" text NOT NULL,
	"subject" text NOT NULL,
	"bio" text DEFAULT '' NOT NULL,
	"photo" text,
	"languages" text[] DEFAULT '{}'::text[] NOT NULL,
	"verification_status" text DEFAULT 'pending' NOT NULL,
	"payout_account_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "teacher_questions" (
	"id" text PRIMARY KEY NOT NULL,
	"teacher_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"student_id" text NOT NULL,
	"text" text NOT NULL,
	"module_hint" text,
	"group_id" text,
	"similar_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" "teacher_question_status" DEFAULT 'open' NOT NULL,
	"answer" text,
	"answered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "topics" (
	"id" text PRIMARY KEY NOT NULL,
	"teacher_id" text NOT NULL,
	"module_id" text NOT NULL,
	"title" text NOT NULL,
	"order" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "turn_traces" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"steps" jsonb NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"cost_micro_usd" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_ledger" (
	"id" text PRIMARY KEY NOT NULL,
	"teacher_id" text NOT NULL,
	"package_id" text NOT NULL,
	"student_id" text NOT NULL,
	"model" text NOT NULL,
	"tier" "model_tier" NOT NULL,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"cost_micro_usd" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text,
	"phone" text,
	"name" text NOT NULL,
	"locale" text NOT NULL,
	"market" text NOT NULL,
	"role" "user_role" NOT NULL,
	"age_confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"provider_event_id" text NOT NULL,
	"payload_hash" text NOT NULL,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_versions" ADD CONSTRAINT "agent_versions_teacher_id_users_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_versions" ADD CONSTRAINT "agent_versions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_teacher_id_users_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_teacher_id_users_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_module_id_modules_id_fk" FOREIGN KEY ("module_id") REFERENCES "public"."modules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_questions" ADD CONSTRAINT "class_questions_live_class_id_live_classes_id_fk" FOREIGN KEY ("live_class_id") REFERENCES "public"."live_classes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corrections" ADD CONSTRAINT "corrections_teacher_id_users_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corrections" ADD CONSTRAINT "corrections_module_id_modules_id_fk" FOREIGN KEY ("module_id") REFERENCES "public"."modules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_teacher_id_users_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_teacher_id_users_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_module_id_modules_id_fk" FOREIGN KEY ("module_id") REFERENCES "public"."modules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_results" ADD CONSTRAINT "eval_results_eval_run_id_eval_runs_id_fk" FOREIGN KEY ("eval_run_id") REFERENCES "public"."eval_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_teacher_id_users_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_agent_version_id_agent_versions_id_fk" FOREIGN KEY ("agent_version_id") REFERENCES "public"."agent_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_events" ADD CONSTRAINT "evidence_events_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_events" ADD CONSTRAINT "evidence_events_teacher_id_users_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_events" ADD CONSTRAINT "evidence_events_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insights" ADD CONSTRAINT "insights_teacher_id_users_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_teacher_id_users_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learner_profiles" ADD CONSTRAINT "learner_profiles_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learner_profiles" ADD CONSTRAINT "learner_profiles_teacher_id_users_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_teacher_id_users_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_payout_id_payouts_id_fk" FOREIGN KEY ("payout_id") REFERENCES "public"."payouts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_classes" ADD CONSTRAINT "live_classes_teacher_id_users_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "modules" ADD CONSTRAINT "modules_teacher_id_users_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "modules" ADD CONSTRAINT "modules_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_versions" ADD CONSTRAINT "package_versions_teacher_id_users_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_versions" ADD CONSTRAINT "package_versions_package_id_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."packages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packages" ADD CONSTRAINT "packages_teacher_id_users_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packages" ADD CONSTRAINT "packages_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_teacher_id_users_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_teacher_id_users_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_teacher_id_users_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "style_cards" ADD CONSTRAINT "style_cards_teacher_id_users_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_teacher_id_users_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_package_version_id_package_versions_id_fk" FOREIGN KEY ("package_version_id") REFERENCES "public"."package_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher_profiles" ADD CONSTRAINT "teacher_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher_questions" ADD CONSTRAINT "teacher_questions_teacher_id_users_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher_questions" ADD CONSTRAINT "teacher_questions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher_questions" ADD CONSTRAINT "teacher_questions_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topics" ADD CONSTRAINT "topics_teacher_id_users_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topics" ADD CONSTRAINT "topics_module_id_modules_id_fk" FOREIGN KEY ("module_id") REFERENCES "public"."modules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turn_traces" ADD CONSTRAINT "turn_traces_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_ledger" ADD CONSTRAINT "usage_ledger_teacher_id_users_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_ledger" ADD CONSTRAINT "usage_ledger_package_id_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."packages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_ledger" ADD CONSTRAINT "usage_ledger_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_versions_agent_id_version_key" ON "agent_versions" USING btree ("agent_id","version");--> statement-breakpoint
CREATE INDEX "agent_versions_teacher_id_idx" ON "agent_versions" USING btree ("teacher_id");--> statement-breakpoint
CREATE INDEX "agents_teacher_id_idx" ON "agents" USING btree ("teacher_id");--> statement-breakpoint
CREATE INDEX "audit_log_target_ts_idx" ON "audit_log" USING btree ("target","ts");--> statement-breakpoint
CREATE INDEX "audit_log_actor_ts_idx" ON "audit_log" USING btree ("actor","ts");--> statement-breakpoint
CREATE INDEX "chunks_teacher_id_module_id_idx" ON "chunks" USING btree ("teacher_id","module_id");--> statement-breakpoint
CREATE INDEX "chunks_module_id_idx" ON "chunks" USING btree ("module_id");--> statement-breakpoint
CREATE INDEX "chunks_document_id_idx" ON "chunks" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "chunks_search_idx" ON "chunks" USING gin ("search");--> statement-breakpoint
CREATE INDEX "class_questions_live_class_id_idx" ON "class_questions" USING btree ("live_class_id");--> statement-breakpoint
CREATE UNIQUE INDEX "consents_user_id_kind_version_key" ON "consents" USING btree ("user_id","kind","version");--> statement-breakpoint
CREATE INDEX "corrections_teacher_id_idx" ON "corrections" USING btree ("teacher_id");--> statement-breakpoint
CREATE INDEX "corrections_module_id_idx" ON "corrections" USING btree ("module_id");--> statement-breakpoint
CREATE INDEX "courses_teacher_id_idx" ON "courses" USING btree ("teacher_id");--> statement-breakpoint
CREATE INDEX "documents_teacher_id_idx" ON "documents" USING btree ("teacher_id");--> statement-breakpoint
CREATE INDEX "documents_module_id_idx" ON "documents" USING btree ("module_id");--> statement-breakpoint
CREATE UNIQUE INDEX "eval_results_eval_run_id_case_id_key" ON "eval_results" USING btree ("eval_run_id","case_id");--> statement-breakpoint
CREATE INDEX "eval_runs_teacher_id_idx" ON "eval_runs" USING btree ("teacher_id");--> statement-breakpoint
CREATE INDEX "eval_runs_agent_version_id_suite_idx" ON "eval_runs" USING btree ("agent_version_id","suite");--> statement-breakpoint
CREATE INDEX "evidence_events_teacher_id_student_id_idx" ON "evidence_events" USING btree ("teacher_id","student_id");--> statement-breakpoint
CREATE INDEX "evidence_events_student_id_idx" ON "evidence_events" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "evidence_events_topic_id_idx" ON "evidence_events" USING btree ("topic_id");--> statement-breakpoint
CREATE UNIQUE INDEX "insights_teacher_id_week_key" ON "insights" USING btree ("teacher_id","week");--> statement-breakpoint
CREATE INDEX "invoices_teacher_id_idx" ON "invoices" USING btree ("teacher_id");--> statement-breakpoint
CREATE INDEX "invoices_student_id_idx" ON "invoices" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "invoices_payment_id_idx" ON "invoices" USING btree ("payment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_number_key" ON "invoices" USING btree ("number");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_provider_provider_ref_key" ON "invoices" USING btree ("provider","provider_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "learner_profiles_teacher_id_student_id_key" ON "learner_profiles" USING btree ("teacher_id","student_id");--> statement-breakpoint
CREATE INDEX "learner_profiles_student_id_idx" ON "learner_profiles" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "ledger_entries_teacher_id_idx" ON "ledger_entries" USING btree ("teacher_id");--> statement-breakpoint
CREATE INDEX "ledger_entries_transaction_id_idx" ON "ledger_entries" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "ledger_entries_account_idx" ON "ledger_entries" USING btree ("account");--> statement-breakpoint
CREATE INDEX "ledger_entries_payment_id_idx" ON "ledger_entries" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "ledger_entries_payout_id_idx" ON "ledger_entries" USING btree ("payout_id");--> statement-breakpoint
CREATE INDEX "live_classes_teacher_id_starts_at_idx" ON "live_classes" USING btree ("teacher_id","starts_at");--> statement-breakpoint
CREATE INDEX "messages_session_id_created_at_idx" ON "messages" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE INDEX "modules_teacher_id_idx" ON "modules" USING btree ("teacher_id");--> statement-breakpoint
CREATE INDEX "modules_course_id_idx" ON "modules" USING btree ("course_id");--> statement-breakpoint
CREATE UNIQUE INDEX "package_versions_package_id_version_key" ON "package_versions" USING btree ("package_id","version");--> statement-breakpoint
CREATE INDEX "package_versions_teacher_id_idx" ON "package_versions" USING btree ("teacher_id");--> statement-breakpoint
CREATE INDEX "packages_teacher_id_idx" ON "packages" USING btree ("teacher_id");--> statement-breakpoint
CREATE INDEX "packages_agent_id_idx" ON "packages" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "payments_teacher_id_idx" ON "payments" USING btree ("teacher_id");--> statement-breakpoint
CREATE INDEX "payments_student_id_idx" ON "payments" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "payments_subscription_id_idx" ON "payments" USING btree ("subscription_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_provider_provider_ref_key" ON "payments" USING btree ("provider","provider_ref");--> statement-breakpoint
CREATE INDEX "payouts_teacher_id_idx" ON "payouts" USING btree ("teacher_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payouts_provider_provider_ref_key" ON "payouts" USING btree ("provider","provider_ref");--> statement-breakpoint
CREATE INDEX "reports_target_idx" ON "reports" USING btree ("target");--> statement-breakpoint
CREATE INDEX "reports_status_idx" ON "reports" USING btree ("status");--> statement-breakpoint
CREATE INDEX "reports_reporter_id_idx" ON "reports" USING btree ("reporter_id");--> statement-breakpoint
CREATE INDEX "safety_events_target_idx" ON "safety_events" USING btree ("target");--> statement-breakpoint
CREATE INDEX "safety_events_status_idx" ON "safety_events" USING btree ("status");--> statement-breakpoint
CREATE INDEX "sessions_teacher_id_student_id_idx" ON "sessions" USING btree ("teacher_id","student_id");--> statement-breakpoint
CREATE INDEX "sessions_student_id_idx" ON "sessions" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "sessions_agent_id_idx" ON "sessions" USING btree ("agent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "style_cards_teacher_id_version_key" ON "style_cards" USING btree ("teacher_id","version");--> statement-breakpoint
CREATE INDEX "subscriptions_teacher_id_student_id_idx" ON "subscriptions" USING btree ("teacher_id","student_id");--> statement-breakpoint
CREATE INDEX "subscriptions_student_id_idx" ON "subscriptions" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "subscriptions_package_version_id_idx" ON "subscriptions" USING btree ("package_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_one_live_per_pair_key" ON "subscriptions" USING btree ("student_id","teacher_id") WHERE "subscriptions"."status" <> 'ended';--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_provider_ref_key" ON "subscriptions" USING btree ("provider_ref");--> statement-breakpoint
CREATE INDEX "takedowns_target_idx" ON "takedowns" USING btree ("target");--> statement-breakpoint
CREATE INDEX "takedowns_status_idx" ON "takedowns" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "teacher_profiles_user_id_key" ON "teacher_profiles" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "teacher_profiles_slug_key" ON "teacher_profiles" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "teacher_questions_teacher_id_status_idx" ON "teacher_questions" USING btree ("teacher_id","status");--> statement-breakpoint
CREATE INDEX "teacher_questions_student_id_idx" ON "teacher_questions" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "teacher_questions_agent_id_idx" ON "teacher_questions" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "teacher_questions_group_id_idx" ON "teacher_questions" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "topics_teacher_id_idx" ON "topics" USING btree ("teacher_id");--> statement-breakpoint
CREATE INDEX "topics_module_id_idx" ON "topics" USING btree ("module_id");--> statement-breakpoint
CREATE INDEX "turn_traces_session_id_idx" ON "turn_traces" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "usage_ledger_teacher_id_package_id_student_id_idx" ON "usage_ledger" USING btree ("teacher_id","package_id","student_id");--> statement-breakpoint
CREATE INDEX "usage_ledger_student_id_idx" ON "usage_ledger" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "usage_ledger_package_id_idx" ON "usage_ledger" USING btree ("package_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_key" ON "users" USING btree ("email") WHERE "users"."email" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "users_phone_key" ON "users" USING btree ("phone") WHERE "users"."phone" is not null;--> statement-breakpoint
CREATE INDEX "users_role_idx" ON "users" USING btree ("role");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_events_provider_event_id_key" ON "webhook_events" USING btree ("provider_event_id");