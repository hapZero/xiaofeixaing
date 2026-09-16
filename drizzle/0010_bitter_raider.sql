CREATE TABLE `episode_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`episode_id` text NOT NULL,
	`version_number` integer NOT NULL,
	`result_asset_id` text,
	`subtitle_asset_id` text,
	`duration_ms` integer DEFAULT 0 NOT NULL,
	`inputs_json` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'ready' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`episode_id`) REFERENCES `episodes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`result_asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`subtitle_asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `episode_versions_episode_version_uidx` ON `episode_versions` (`episode_id`,`version_number`);--> statement-breakpoint
CREATE INDEX `episode_versions_episode_idx` ON `episode_versions` (`episode_id`);--> statement-breakpoint
ALTER TABLE `episodes` ADD `video_asset_id` text;--> statement-breakpoint
ALTER TABLE `episodes` ADD `subtitle_asset_id` text;--> statement-breakpoint
ALTER TABLE `episodes` ADD `current_version_number` integer DEFAULT 0 NOT NULL;