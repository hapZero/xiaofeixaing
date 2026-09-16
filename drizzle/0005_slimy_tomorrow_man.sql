CREATE TABLE `service_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`provider` text NOT NULL,
	`base_url` text NOT NULL,
	`model` text,
	`secret_ciphertext` text,
	`config_json` text DEFAULT '{}' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `service_connections_owner_kind_uidx` ON `service_connections` (`owner_id`,`kind`);--> statement-breakpoint
CREATE INDEX `service_connections_owner_idx` ON `service_connections` (`owner_id`);--> statement-breakpoint
DROP INDEX `workflow_bindings_owner_source_uidx`;--> statement-breakpoint
CREATE INDEX `workflow_bindings_owner_source_idx` ON `workflow_bindings` (`owner_id`,`source_workflow_id`);