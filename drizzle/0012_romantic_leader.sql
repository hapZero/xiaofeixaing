CREATE TABLE `character_form_references` (
	`id` text PRIMARY KEY NOT NULL,
	`character_form_id` text NOT NULL,
	`asset_id` text NOT NULL,
	`reference_type` text DEFAULT 'reference' NOT NULL,
	`reference_order` integer DEFAULT 0 NOT NULL,
	`is_primary` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`character_form_id`) REFERENCES `character_forms`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `character_form_references_form_idx` ON `character_form_references` (`character_form_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `character_form_references_form_order_uidx` ON `character_form_references` (`character_form_id`,`reference_order`);--> statement-breakpoint
INSERT INTO `character_form_references` (`id`, `character_form_id`, `asset_id`, `reference_type`, `reference_order`, `is_primary`, `created_at`, `updated_at`)
SELECT 'legacy-' || `id`, `id`, `asset_id`, 'primary', 0, true, `created_at`, `updated_at`
FROM `character_forms`
WHERE `asset_id` IS NOT NULL;
