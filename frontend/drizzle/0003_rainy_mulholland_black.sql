CREATE TABLE "theatre_members" (
	"user_id" text PRIMARY KEY NOT NULL,
	"customer_id" text,
	"checkout_attempt" text NOT NULL,
	"checkout_started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"checkout_session_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "theatre_members_customer_id_unique" UNIQUE("customer_id"),
	CONSTRAINT "theatre_members_checkout_session_id_unique" UNIQUE("checkout_session_id")
);
--> statement-breakpoint
CREATE TABLE "theatre_subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"customer_id" text NOT NULL,
	"status" text NOT NULL,
	"paid_through" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"livemode" boolean DEFAULT false NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "theatre_videos" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"mux_asset_id" text NOT NULL,
	"playback_id" text,
	"status" text DEFAULT 'preparing' NOT NULL,
	"published" boolean DEFAULT false NOT NULL,
	"is_sample" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "theatre_videos_mux_asset_id_unique" UNIQUE("mux_asset_id"),
	CONSTRAINT "theatre_videos_playback_id_unique" UNIQUE("playback_id")
);
--> statement-breakpoint
ALTER TABLE "theatre_subscriptions" ADD CONSTRAINT "theatre_subscriptions_user_id_theatre_members_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."theatre_members"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "theatre_subscriptions_user_idx" ON "theatre_subscriptions" USING btree ("user_id");