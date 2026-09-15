CREATE TABLE "office_email_jobs" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"reference" varchar(16) NOT NULL,
	"kind" varchar(12) NOT NULL,
	"payload" jsonb NOT NULL,
	"status" varchar(12) DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"first_attempt_at" timestamp with time zone,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_until" timestamp with time zone,
	"lock_token" varchar(36),
	"sent_at" timestamp with time zone,
	"last_error" varchar(80),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "service_requests" ADD COLUMN "submission_key" varchar(64);--> statement-breakpoint
ALTER TABLE "service_requests" ADD COLUMN "payload_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "office_email_jobs" ADD CONSTRAINT "office_email_jobs_reference_service_requests_reference_fk" FOREIGN KEY ("reference") REFERENCES "public"."service_requests"("reference") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "office_email_jobs_due_idx" ON "office_email_jobs" USING btree ("status","next_attempt_at");--> statement-breakpoint
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_submission_key_unique" UNIQUE("submission_key");