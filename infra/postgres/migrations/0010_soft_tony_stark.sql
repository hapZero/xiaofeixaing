CREATE TABLE "character_form_references" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"character_form_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"reference_type" text DEFAULT 'reference' NOT NULL,
	"reference_order" integer DEFAULT 0 NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "character_form_references" ADD CONSTRAINT "character_form_references_character_form_id_character_forms_id_fk" FOREIGN KEY ("character_form_id") REFERENCES "public"."character_forms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_form_references" ADD CONSTRAINT "character_form_references_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "character_form_references_form_idx" ON "character_form_references" USING btree ("character_form_id");--> statement-breakpoint
CREATE UNIQUE INDEX "character_form_references_form_order_uidx" ON "character_form_references" USING btree ("character_form_id","reference_order");--> statement-breakpoint
INSERT INTO "character_form_references" ("character_form_id", "asset_id", "reference_type", "reference_order", "is_primary", "created_at", "updated_at")
SELECT "id", "asset_id", 'primary', 0, true, "created_at", "updated_at"
FROM "character_forms"
WHERE "asset_id" IS NOT NULL;
