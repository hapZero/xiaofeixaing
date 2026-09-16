CREATE TABLE "segment_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"segment_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"prompt" text NOT NULL,
	"inputs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result_asset_id" uuid,
	"production_mode" text DEFAULT 'unified_segment' NOT NULL,
	"quality" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'ready' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "segments" ADD COLUMN "video_asset_id" uuid;--> statement-breakpoint
ALTER TABLE "segments" ADD COLUMN "current_version_number" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "segment_versions" ADD CONSTRAINT "segment_versions_segment_id_segments_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."segments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segment_versions" ADD CONSTRAINT "segment_versions_result_asset_id_assets_id_fk" FOREIGN KEY ("result_asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "segment_versions_segment_version_uidx" ON "segment_versions" USING btree ("segment_id","version_number");--> statement-breakpoint
CREATE INDEX "segment_versions_segment_idx" ON "segment_versions" USING btree ("segment_id");--> statement-breakpoint
ALTER TABLE "segments" ADD CONSTRAINT "segments_video_asset_id_assets_id_fk" FOREIGN KEY ("video_asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;