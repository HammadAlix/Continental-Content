CREATE TABLE "service_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"reference" varchar(16) NOT NULL,
	"name" varchar(80) NOT NULL,
	"email" varchar(160) NOT NULL,
	"service" varchar(40) NOT NULL,
	"details" text NOT NULL,
	"ip_hash" varchar(64),
	"user_agent" text,
	"notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_requests_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
CREATE INDEX "service_requests_created_at_idx" ON "service_requests" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "service_requests_email_idx" ON "service_requests" USING btree ("email");