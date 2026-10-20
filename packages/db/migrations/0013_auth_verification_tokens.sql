CREATE TABLE "auth_verification_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "auth_verification_tokens_identifier_key" ON "auth_verification_tokens" USING btree ("identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_verification_tokens_token_hash_key" ON "auth_verification_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "auth_verification_tokens_expires_at_idx" ON "auth_verification_tokens" USING btree ("expires_at");