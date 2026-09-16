CREATE TABLE `segment_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`segment_id` text NOT NULL,
	`version_number` integer NOT NULL,
	`prompt` text NOT NULL,
	`inputs_json` text DEFAULT '{}' NOT NULL,
	`result_asset_id` text,
	`production_mode` text DEFAULT 'unified_segment' NOT NULL,
	`quality_json` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'ready' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`segment_id`) REFERENCES `segments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`result_asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `segment_versions_segment_version_uidx` ON `segment_versions` (`segment_id`,`version_number`);--> statement-breakpoint
CREATE INDEX `segment_versions_segment_idx` ON `segment_versions` (`segment_id`);--> statement-breakpoint
ALTER TABLE `segments` ADD `video_asset_id` text;--> statement-breakpoint
ALTER TABLE `segments` ADD `current_version_number` integer DEFAULT 0 NOT NULL;