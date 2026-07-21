CREATE TABLE `assets` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`episode_id` text,
	`asset_type` text NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`storage_key` text,
	`thumbnail_url` text,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`episode_id`) REFERENCES `episodes`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `assets_project_type_idx` ON `assets` (`project_id`,`asset_type`);--> statement-breakpoint
CREATE TABLE `audio_presets` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`preset_type` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`asset_id` text,
	`config_json` text DEFAULT '{}' NOT NULL,
	`locked` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `audio_presets_project_type_idx` ON `audio_presets` (`project_id`,`preset_type`);--> statement-breakpoint
CREATE TABLE `canvas_edges` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`from_node_id` text NOT NULL,
	`to_node_id` text NOT NULL,
	`edge_type` text DEFAULT 'reference' NOT NULL,
	`label` text DEFAULT '内容关联' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`from_node_id`) REFERENCES `canvas_nodes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`to_node_id`) REFERENCES `canvas_nodes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `canvas_edges_project_idx` ON `canvas_edges` (`project_id`);--> statement-breakpoint
CREATE TABLE `canvas_nodes` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`node_type` text NOT NULL,
	`ref_type` text,
	`ref_id` text,
	`title` text NOT NULL,
	`content_json` text DEFAULT '{}' NOT NULL,
	`x` integer NOT NULL,
	`y` integer NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `canvas_nodes_project_idx` ON `canvas_nodes` (`project_id`);--> statement-breakpoint
CREATE TABLE `character_forms` (
	`id` text PRIMARY KEY NOT NULL,
	`character_id` text NOT NULL,
	`name` text NOT NULL,
	`asset_id` text,
	`episode_scope_json` text DEFAULT '[]' NOT NULL,
	`inherit_voice` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`character_id`) REFERENCES `characters`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `character_forms_character_idx` ON `character_forms` (`character_id`);--> statement-breakpoint
CREATE TABLE `characters` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`asset_id` text,
	`canonical_name` text NOT NULL,
	`profile_json` text DEFAULT '{}' NOT NULL,
	`voice_asset_id` text,
	`voice_description` text,
	`voice_locked` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`voice_asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `characters_project_idx` ON `characters` (`project_id`);--> statement-breakpoint
CREATE TABLE `episodes` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`episode_number` integer NOT NULL,
	`title` text NOT NULL,
	`summary` text,
	`script_text` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `episodes_project_number_uidx` ON `episodes` (`project_id`,`episode_number`);--> statement-breakpoint
CREATE INDEX `episodes_project_idx` ON `episodes` (`project_id`);--> statement-breakpoint
CREATE TABLE `generation_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`project_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`capability` text NOT NULL,
	`workflow_binding_id` text,
	`status` text DEFAULT 'queued' NOT NULL,
	`comfy_prompt_id` text,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`result_json` text,
	`error_code` text,
	`error_message` text,
	`started_at` integer,
	`finished_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workflow_binding_id`) REFERENCES `workflow_bindings`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `generation_jobs_project_created_idx` ON `generation_jobs` (`project_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `generation_jobs_owner_status_idx` ON `generation_jobs` (`owner_id`,`status`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`title` text NOT NULL,
	`source_type` text DEFAULT 'script' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`style_preset` text DEFAULT '写实电影风格' NOT NULL,
	`aspect_ratio` text DEFAULT '16:9' NOT NULL,
	`synopsis` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `projects_owner_updated_idx` ON `projects` (`owner_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `shots` (
	`id` text PRIMARY KEY NOT NULL,
	`episode_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`title` text NOT NULL,
	`prompt` text DEFAULT '' NOT NULL,
	`duration_ms` integer DEFAULT 5000 NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`first_frame_asset_id` text,
	`video_asset_id` text,
	`environment_preset_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`episode_id`) REFERENCES `episodes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`first_frame_asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`video_asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`environment_preset_id`) REFERENCES `audio_presets`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shots_episode_sequence_uidx` ON `shots` (`episode_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `shots_episode_idx` ON `shots` (`episode_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`display_name` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_uidx` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `workflow_bindings` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`capability` text NOT NULL,
	`name` text NOT NULL,
	`workflow_storage_key` text NOT NULL,
	`input_contract_json` text DEFAULT '{}' NOT NULL,
	`output_contract_json` text DEFAULT '{}' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workflow_bindings_owner_capability_uidx` ON `workflow_bindings` (`owner_id`,`capability`);