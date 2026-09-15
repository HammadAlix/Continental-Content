CREATE TABLE "checkout_limits" (
	"key" varchar(96) PRIMARY KEY NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "merch_orders" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"attempt_id" varchar(36) NOT NULL,
	"cart_hash" varchar(64) NOT NULL,
	"items" jsonb NOT NULL,
	"subtotal" integer NOT NULL,
	"shipping" integer NOT NULL,
	"total" integer NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"stripe_session_id" text,
	"email" text,
	"delivery" jsonb,
	"paid_at" timestamp with time zone,
	"customer_notified_at" timestamp with time zone,
	"desk_notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "merch_orders_attempt_id_unique" UNIQUE("attempt_id"),
	CONSTRAINT "merch_orders_stripe_session_id_unique" UNIQUE("stripe_session_id")
);
