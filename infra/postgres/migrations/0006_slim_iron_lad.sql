CREATE TABLE "media_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"operation" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result" jsonb,
	"error_code" text,
	"error_message" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dialogue_lines" ADD COLUMN "voice_reference_asset_id" uuid;--> statement-breakpoint
ALTER TABLE "dialogue_lines" ADD COLUMN "audio_asset_id" uuid;--> statement-breakpoint
UPDATE "dialogue_lines" SET "voice_reference_asset_id" = "voice_asset_id" WHERE "voice_reference_asset_id" IS NULL AND "voice_asset_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "segments" ADD COLUMN "audio_asset_id" uuid;--> statement-breakpoint
ALTER TABLE "media_jobs" ADD CONSTRAINT "media_jobs_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_jobs" ADD CONSTRAINT "media_jobs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "media_jobs_project_created_idx" ON "media_jobs" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "media_jobs_owner_status_idx" ON "media_jobs" USING btree ("owner_id","status");--> statement-breakpoint
CREATE INDEX "media_jobs_entity_operation_idx" ON "media_jobs" USING btree ("entity_type","entity_id","operation");--> statement-breakpoint
ALTER TABLE "dialogue_lines" ADD CONSTRAINT "dialogue_lines_voice_reference_asset_id_assets_id_fk" FOREIGN KEY ("voice_reference_asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dialogue_lines" ADD CONSTRAINT "dialogue_lines_audio_asset_id_assets_id_fk" FOREIGN KEY ("audio_asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segments" ADD CONSTRAINT "segments_audio_asset_id_assets_id_fk" FOREIGN KEY ("audio_asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;
