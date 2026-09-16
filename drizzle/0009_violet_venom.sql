CREATE TABLE `media_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`project_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`operation` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`progress` integer DEFAULT 0 NOT NULL,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`result_json` text,
	`error_code` text,
	`error_message` text,
	`started_at` integer,
	`finished_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `media_jobs_project_created_idx` ON `media_jobs` (`project_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `media_jobs_owner_status_idx` ON `media_jobs` (`owner_id`,`status`);--> statement-breakpoint
CREATE INDEX `media_jobs_entity_operation_idx` ON `media_jobs` (`entity_type`,`entity_id`,`operation`);--> statement-breakpoint
ALTER TABLE `dialogue_lines` ADD `voice_reference_asset_id` text REFERENCES assets(id);--> statement-breakpoint
ALTER TABLE `dialogue_lines` ADD `audio_asset_id` text REFERENCES assets(id);--> statement-breakpoint
UPDATE `dialogue_lines` SET `voice_reference_asset_id` = `voice_asset_id` WHERE `voice_reference_asset_id` IS NULL AND `voice_asset_id` IS NOT NULL;--> statement-breakpoint
ALTER TABLE `segments` ADD `audio_asset_id` text;
