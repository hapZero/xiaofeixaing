CREATE TABLE `workflow_execution_events` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`execution_type` text NOT NULL,
	`execution_id` text NOT NULL,
	`prompt_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`event_type` text NOT NULL,
	`node_id` text,
	`node_title` text,
	`node_value` integer,
	`node_max` integer,
	`overall_progress` integer DEFAULT 0 NOT NULL,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workflow_execution_events_execution_sequence_uidx` ON `workflow_execution_events` (`execution_type`,`execution_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `workflow_execution_events_prompt_idx` ON `workflow_execution_events` (`prompt_id`,`sequence`);--> statement-breakpoint
CREATE TABLE `workflow_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`bridge_workflow_id` text NOT NULL,
	`version` text NOT NULL,
	`name` text NOT NULL,
	`workflow_storage_key` text NOT NULL,
	`node_manifest_json` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workflow_versions_owner_bridge_version_uidx` ON `workflow_versions` (`owner_id`,`bridge_workflow_id`,`version`);--> statement-breakpoint
CREATE INDEX `workflow_versions_owner_updated_idx` ON `workflow_versions` (`owner_id`,`updated_at`);--> statement-breakpoint
ALTER TABLE `workflow_bindings` ADD `source_type` text DEFAULT 'upload' NOT NULL;--> statement-breakpoint
ALTER TABLE `workflow_bindings` ADD `source_workflow_id` text;--> statement-breakpoint
ALTER TABLE `workflow_bindings` ADD `source_version` text;