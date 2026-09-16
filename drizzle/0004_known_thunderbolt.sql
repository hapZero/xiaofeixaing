CREATE TABLE `audio_tracks` (
	`id` text PRIMARY KEY NOT NULL,
	`episode_id` text NOT NULL,
	`segment_id` text,
	`shot_id` text,
	`track_type` text NOT NULL,
	`asset_id` text,
	`preset_id` text,
	`start_ms` integer DEFAULT 0 NOT NULL,
	`duration_ms` integer DEFAULT 0 NOT NULL,
	`gain_centi_db` integer DEFAULT 0 NOT NULL,
	`config_json` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`episode_id`) REFERENCES `episodes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`segment_id`) REFERENCES `segments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`shot_id`) REFERENCES `shots`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`preset_id`) REFERENCES `audio_presets`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `audio_tracks_episode_type_idx` ON `audio_tracks` (`episode_id`,`track_type`);--> statement-breakpoint
CREATE INDEX `audio_tracks_shot_idx` ON `audio_tracks` (`shot_id`);--> statement-breakpoint
CREATE TABLE `dialogue_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`shot_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`speaker_character_id` text,
	`line_type` text DEFAULT 'dialogue' NOT NULL,
	`text` text NOT NULL,
	`emotion` text,
	`delivery_json` text DEFAULT '{}' NOT NULL,
	`voice_asset_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`shot_id`) REFERENCES `shots`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`speaker_character_id`) REFERENCES `characters`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`voice_asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dialogue_lines_shot_sequence_uidx` ON `dialogue_lines` (`shot_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `dialogue_lines_shot_idx` ON `dialogue_lines` (`shot_id`);--> statement-breakpoint
CREATE TABLE `segments` (
	`id` text PRIMARY KEY NOT NULL,
	`episode_id` text NOT NULL,
	`story_scene_id` text,
	`sequence` integer NOT NULL,
	`title` text NOT NULL,
	`synopsis` text DEFAULT '' NOT NULL,
	`duration_ms` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`episode_id`) REFERENCES `episodes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`story_scene_id`) REFERENCES `story_scenes`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `segments_episode_sequence_uidx` ON `segments` (`episode_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `segments_episode_idx` ON `segments` (`episode_id`);--> statement-breakpoint
CREATE TABLE `shot_asset_references` (
	`id` text PRIMARY KEY NOT NULL,
	`shot_id` text NOT NULL,
	`asset_id` text,
	`character_id` text,
	`character_form_id` text,
	`reference_role` text NOT NULL,
	`reference_order` integer DEFAULT 0 NOT NULL,
	`required` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`shot_id`) REFERENCES `shots`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`character_id`) REFERENCES `characters`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`character_form_id`) REFERENCES `character_forms`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `shot_asset_references_shot_idx` ON `shot_asset_references` (`shot_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `shot_asset_references_unique_idx` ON `shot_asset_references` (`shot_id`,`reference_role`,`reference_order`);--> statement-breakpoint
CREATE TABLE `shot_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`shot_id` text NOT NULL,
	`version_number` integer NOT NULL,
	`prompt` text NOT NULL,
	`inputs_json` text DEFAULT '{}' NOT NULL,
	`result_asset_id` text,
	`quality_json` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`shot_id`) REFERENCES `shots`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`result_asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shot_versions_shot_version_uidx` ON `shot_versions` (`shot_id`,`version_number`);--> statement-breakpoint
CREATE INDEX `shot_versions_shot_idx` ON `shot_versions` (`shot_id`);--> statement-breakpoint
CREATE TABLE `story_bibles` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`source_revision` integer DEFAULT 1 NOT NULL,
	`logline` text,
	`world_json` text DEFAULT '{}' NOT NULL,
	`timeline_json` text DEFAULT '[]' NOT NULL,
	`relationships_json` text DEFAULT '[]' NOT NULL,
	`style_guide_json` text DEFAULT '{}' NOT NULL,
	`narration_mode` text DEFAULT 'dialogue' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `story_bibles_project_uidx` ON `story_bibles` (`project_id`);--> statement-breakpoint
CREATE TABLE `story_scenes` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`asset_id` text,
	`name` text NOT NULL,
	`episode_scope_json` text DEFAULT '[]' NOT NULL,
	`time_of_day` text,
	`interior_exterior` text,
	`visual_continuity_json` text DEFAULT '{}' NOT NULL,
	`audio_preset_id` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `story_scenes_project_name_uidx` ON `story_scenes` (`project_id`,`name`);--> statement-breakpoint
CREATE INDEX `story_scenes_project_idx` ON `story_scenes` (`project_id`);--> statement-breakpoint
ALTER TABLE `shots` ADD `segment_id` text REFERENCES segments(id);--> statement-breakpoint
ALTER TABLE `shots` ADD `shot_type` text DEFAULT 'visual' NOT NULL;--> statement-breakpoint
ALTER TABLE `shots` ADD `camera_json` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `shots` ADD `sound_plan_json` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `shots` ADD `generation_plan_json` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
CREATE INDEX `shots_segment_idx` ON `shots` (`segment_id`);