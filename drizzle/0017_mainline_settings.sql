CREATE TABLE `production_routing_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`rule_key` text NOT NULL,
	`name` text NOT NULL,
	`condition_json` text DEFAULT '{}' NOT NULL,
	`target_capability` text NOT NULL,
	`priority` integer DEFAULT 100 NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `production_routing_rules_owner_rule_uidx` ON `production_routing_rules` (`owner_id`,`rule_key`);--> statement-breakpoint
CREATE INDEX `production_routing_rules_owner_idx` ON `production_routing_rules` (`owner_id`);--> statement-breakpoint
ALTER TABLE `dialogue_lines` ADD `duration_ms` integer;
