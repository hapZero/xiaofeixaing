CREATE TABLE `segment_asset_references` (
	`id` text PRIMARY KEY NOT NULL,
	`segment_id` text NOT NULL,
	`asset_id` text,
	`character_id` text,
	`character_form_id` text,
	`reference_role` text NOT NULL,
	`reference_order` integer DEFAULT 0 NOT NULL,
	`required` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`segment_id`) REFERENCES `segments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`character_id`) REFERENCES `characters`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`character_form_id`) REFERENCES `character_forms`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `segment_asset_references_segment_idx` ON `segment_asset_references` (`segment_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `segment_asset_references_unique_idx` ON `segment_asset_references` (`segment_id`,`reference_role`,`reference_order`);--> statement-breakpoint
ALTER TABLE `segments` ADD `reference_mode` text DEFAULT 'automatic' NOT NULL;