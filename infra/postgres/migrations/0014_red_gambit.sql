CREATE TABLE "segment_asset_references" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"segment_id" uuid NOT NULL,
	"asset_id" uuid,
	"character_id" uuid,
	"character_form_id" uuid,
	"reference_role" text NOT NULL,
	"reference_order" integer DEFAULT 0 NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "segments" ADD COLUMN "reference_mode" text DEFAULT 'automatic' NOT NULL;--> statement-breakpoint
ALTER TABLE "segment_asset_references" ADD CONSTRAINT "segment_asset_references_segment_id_segments_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."segments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segment_asset_references" ADD CONSTRAINT "segment_asset_references_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segment_asset_references" ADD CONSTRAINT "segment_asset_references_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segment_asset_references" ADD CONSTRAINT "segment_asset_references_character_form_id_character_forms_id_fk" FOREIGN KEY ("character_form_id") REFERENCES "public"."character_forms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "segment_asset_references_segment_idx" ON "segment_asset_references" USING btree ("segment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "segment_asset_references_unique_idx" ON "segment_asset_references" USING btree ("segment_id","reference_role","reference_order");