CREATE TABLE "episode_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"episode_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"result_asset_id" uuid,
	"subtitle_asset_id" uuid,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"inputs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'ready' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "episodes" ADD COLUMN "video_asset_id" uuid;--> statement-breakpoint
ALTER TABLE "episodes" ADD COLUMN "subtitle_asset_id" uuid;--> statement-breakpoint
ALTER TABLE "episodes" ADD COLUMN "current_version_number" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "episode_versions" ADD CONSTRAINT "episode_versions_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episode_versions" ADD CONSTRAINT "episode_versions_result_asset_id_assets_id_fk" FOREIGN KEY ("result_asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episode_versions" ADD CONSTRAINT "episode_versions_subtitle_asset_id_assets_id_fk" FOREIGN KEY ("subtitle_asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "episode_versions_episode_version_uidx" ON "episode_versions" USING btree ("episode_id","version_number");--> statement-breakpoint
CREATE INDEX "episode_versions_episode_idx" ON "episode_versions" USING btree ("episode_id");