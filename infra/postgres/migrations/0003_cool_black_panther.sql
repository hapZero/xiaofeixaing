CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"episode_id" uuid,
	"asset_type" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"storage_key" text,
	"thumbnail_url" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audio_presets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"preset_type" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"asset_id" uuid,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"locked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audio_tracks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"episode_id" uuid NOT NULL,
	"segment_id" uuid,
	"shot_id" uuid,
	"track_type" text NOT NULL,
	"asset_id" uuid,
	"preset_id" uuid,
	"start_ms" integer DEFAULT 0 NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"gain_centi_db" integer DEFAULT 0 NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "character_forms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"character_id" uuid NOT NULL,
	"name" text NOT NULL,
	"asset_id" uuid,
	"episode_scope" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"inherit_voice" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "characters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"asset_id" uuid,
	"canonical_name" text NOT NULL,
	"profile" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"voice_asset_id" uuid,
	"voice_description" text,
	"voice_locked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dialogue_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shot_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"speaker_character_id" uuid,
	"line_type" text DEFAULT 'dialogue' NOT NULL,
	"text" text NOT NULL,
	"emotion" text,
	"delivery" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"voice_asset_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "episodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"episode_number" integer NOT NULL,
	"title" text NOT NULL,
	"summary" text,
	"script_text" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "segments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"episode_id" uuid NOT NULL,
	"story_scene_id" uuid,
	"sequence" integer NOT NULL,
	"title" text NOT NULL,
	"synopsis" text DEFAULT '' NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shot_asset_references" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shot_id" uuid NOT NULL,
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
CREATE TABLE "shot_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shot_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"prompt" text NOT NULL,
	"inputs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result_asset_id" uuid,
	"quality" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"episode_id" uuid NOT NULL,
	"segment_id" uuid,
	"sequence" integer NOT NULL,
	"title" text NOT NULL,
	"prompt" text DEFAULT '' NOT NULL,
	"duration_ms" integer DEFAULT 5000 NOT NULL,
	"shot_type" text DEFAULT 'visual' NOT NULL,
	"camera" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sound_plan" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"generation_plan" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"first_frame_asset_id" uuid,
	"video_asset_id" uuid,
	"environment_preset_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "story_bibles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"source_revision" integer DEFAULT 1 NOT NULL,
	"logline" text,
	"world" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"timeline" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"relationships" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"style_guide" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"narration_mode" text DEFAULT 'dialogue' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "story_scenes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"asset_id" uuid,
	"name" text NOT NULL,
	"episode_scope" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"time_of_day" text,
	"interior_exterior" text,
	"visual_continuity" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"audio_preset_id" uuid,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audio_presets" ADD CONSTRAINT "audio_presets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audio_presets" ADD CONSTRAINT "audio_presets_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audio_tracks" ADD CONSTRAINT "audio_tracks_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audio_tracks" ADD CONSTRAINT "audio_tracks_segment_id_segments_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."segments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audio_tracks" ADD CONSTRAINT "audio_tracks_shot_id_shots_id_fk" FOREIGN KEY ("shot_id") REFERENCES "public"."shots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audio_tracks" ADD CONSTRAINT "audio_tracks_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audio_tracks" ADD CONSTRAINT "audio_tracks_preset_id_audio_presets_id_fk" FOREIGN KEY ("preset_id") REFERENCES "public"."audio_presets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_forms" ADD CONSTRAINT "character_forms_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_forms" ADD CONSTRAINT "character_forms_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_voice_asset_id_assets_id_fk" FOREIGN KEY ("voice_asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dialogue_lines" ADD CONSTRAINT "dialogue_lines_shot_id_shots_id_fk" FOREIGN KEY ("shot_id") REFERENCES "public"."shots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dialogue_lines" ADD CONSTRAINT "dialogue_lines_speaker_character_id_characters_id_fk" FOREIGN KEY ("speaker_character_id") REFERENCES "public"."characters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dialogue_lines" ADD CONSTRAINT "dialogue_lines_voice_asset_id_assets_id_fk" FOREIGN KEY ("voice_asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segments" ADD CONSTRAINT "segments_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segments" ADD CONSTRAINT "segments_story_scene_id_story_scenes_id_fk" FOREIGN KEY ("story_scene_id") REFERENCES "public"."story_scenes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shot_asset_references" ADD CONSTRAINT "shot_asset_references_shot_id_shots_id_fk" FOREIGN KEY ("shot_id") REFERENCES "public"."shots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shot_asset_references" ADD CONSTRAINT "shot_asset_references_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shot_asset_references" ADD CONSTRAINT "shot_asset_references_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shot_asset_references" ADD CONSTRAINT "shot_asset_references_character_form_id_character_forms_id_fk" FOREIGN KEY ("character_form_id") REFERENCES "public"."character_forms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shot_versions" ADD CONSTRAINT "shot_versions_shot_id_shots_id_fk" FOREIGN KEY ("shot_id") REFERENCES "public"."shots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shot_versions" ADD CONSTRAINT "shot_versions_result_asset_id_assets_id_fk" FOREIGN KEY ("result_asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shots" ADD CONSTRAINT "shots_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shots" ADD CONSTRAINT "shots_segment_id_segments_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."segments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shots" ADD CONSTRAINT "shots_first_frame_asset_id_assets_id_fk" FOREIGN KEY ("first_frame_asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shots" ADD CONSTRAINT "shots_video_asset_id_assets_id_fk" FOREIGN KEY ("video_asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shots" ADD CONSTRAINT "shots_environment_preset_id_audio_presets_id_fk" FOREIGN KEY ("environment_preset_id") REFERENCES "public"."audio_presets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_bibles" ADD CONSTRAINT "story_bibles_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_scenes" ADD CONSTRAINT "story_scenes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_scenes" ADD CONSTRAINT "story_scenes_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_scenes" ADD CONSTRAINT "story_scenes_audio_preset_id_audio_presets_id_fk" FOREIGN KEY ("audio_preset_id") REFERENCES "public"."audio_presets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assets_project_type_idx" ON "assets" USING btree ("project_id","asset_type");--> statement-breakpoint
CREATE INDEX "audio_presets_project_type_idx" ON "audio_presets" USING btree ("project_id","preset_type");--> statement-breakpoint
CREATE INDEX "audio_tracks_episode_type_idx" ON "audio_tracks" USING btree ("episode_id","track_type");--> statement-breakpoint
CREATE INDEX "audio_tracks_shot_idx" ON "audio_tracks" USING btree ("shot_id");--> statement-breakpoint
CREATE INDEX "character_forms_character_idx" ON "character_forms" USING btree ("character_id");--> statement-breakpoint
CREATE INDEX "characters_project_idx" ON "characters" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dialogue_lines_shot_sequence_uidx" ON "dialogue_lines" USING btree ("shot_id","sequence");--> statement-breakpoint
CREATE INDEX "dialogue_lines_shot_idx" ON "dialogue_lines" USING btree ("shot_id");--> statement-breakpoint
CREATE UNIQUE INDEX "episodes_project_number_uidx" ON "episodes" USING btree ("project_id","episode_number");--> statement-breakpoint
CREATE INDEX "episodes_project_idx" ON "episodes" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "segments_episode_sequence_uidx" ON "segments" USING btree ("episode_id","sequence");--> statement-breakpoint
CREATE INDEX "segments_episode_idx" ON "segments" USING btree ("episode_id");--> statement-breakpoint
CREATE INDEX "shot_asset_references_shot_idx" ON "shot_asset_references" USING btree ("shot_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shot_asset_references_unique_idx" ON "shot_asset_references" USING btree ("shot_id","reference_role","reference_order");--> statement-breakpoint
CREATE UNIQUE INDEX "shot_versions_shot_version_uidx" ON "shot_versions" USING btree ("shot_id","version_number");--> statement-breakpoint
CREATE INDEX "shot_versions_shot_idx" ON "shot_versions" USING btree ("shot_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shots_episode_sequence_uidx" ON "shots" USING btree ("episode_id","sequence");--> statement-breakpoint
CREATE INDEX "shots_episode_idx" ON "shots" USING btree ("episode_id");--> statement-breakpoint
CREATE INDEX "shots_segment_idx" ON "shots" USING btree ("segment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "story_bibles_project_uidx" ON "story_bibles" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "story_scenes_project_name_uidx" ON "story_scenes" USING btree ("project_id","name");--> statement-breakpoint
CREATE INDEX "story_scenes_project_idx" ON "story_scenes" USING btree ("project_id");