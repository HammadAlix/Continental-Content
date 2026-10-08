CREATE TABLE "merch_product_audit" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" varchar(80) NOT NULL,
	"actor_id" text NOT NULL,
	"revision" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "merch_products" (
	"id" varchar(80) PRIMARY KEY NOT NULL,
	"data" jsonb NOT NULL,
	"published" boolean DEFAULT false NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"image_base64" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "merch_audit_created_idx" ON "merch_product_audit" USING btree ("created_at");
--> statement-breakpoint
INSERT INTO merch_products (id, data, published) VALUES
('moonlight-hoodie', '{"id":"moonlight-hoodie","name":"Moonlight Hoodie","category":"Minimalist white hoodie","group":"hoodies","price":6000,"description":"Minimalist white hoodie.","sizes":["S","M","L","XL"]}'::jsonb, true),
('midnight-hoodie', '{"id":"midnight-hoodie","name":"Midnight Hoodie","category":"Minimalist black hoodie","group":"hoodies","price":6000,"description":"Minimalist black hoodie.","sizes":["S","M","L","XL"]}'::jsonb, true),
('kuku-hoodie', '{"id":"kuku-hoodie","name":"KuKu Hoodie","category":"Graphic white hoodie","group":"hoodies","price":7500,"description":"Graphic white hoodie.","sizes":["S","M","L","XL"]}'::jsonb, true),
('tri-hoodie', '{"id":"tri-hoodie","name":"Tri Hoodie","category":"Graphic black hoodie","group":"hoodies","price":7500,"description":"Graphic black hoodie.","sizes":["S","M","L","XL"]}'::jsonb, true),
('casual-cont-white', '{"id":"casual-cont-white","name":"Casual Cont White T","category":"Minimalist white T-shirt","group":"tees","price":3500,"description":"Minimalist white T-shirt.","sizes":["S","M","L","XL"]}'::jsonb, true),
('casual-cont-black', '{"id":"casual-cont-black","name":"Casual Cont Black","category":"Minimalist black T-shirt","group":"tees","price":3500,"description":"Minimalist black T-shirt.","sizes":["S","M","L","XL"]}'::jsonb, true),
('continental-slides', '{"id":"continental-slides","name":"Continental Slides","category":"Flip flops","group":"slides","price":6500,"description":"Continental flip flops in sizes 6–12. Footwear sizing system to be confirmed.","sizes":["6","7","8","9","10","11","12"]}'::jsonb, true),
('continental-apocalypse', '{"id":"continental-apocalypse","name":"Continental Apocalypse","category":"Varsity jacket","group":"jackets","price":22500,"description":"Varsity jacket.","sizes":["S","L","XL"]}'::jsonb, true),
('continental-rebirth', '{"id":"continental-rebirth","name":"Continental Rebirth","category":"Varsity jacket","group":"jackets","price":20000,"description":"Varsity jacket.","sizes":["S","L","XL"]}'::jsonb, true)
ON CONFLICT (id) DO NOTHING;
