CREATE TABLE `runtime_heartbeats` (
	`service` text PRIMARY KEY NOT NULL,
	`instance_id` text NOT NULL,
	`status` text DEFAULT 'online' NOT NULL,
	`details_json` text DEFAULT '{}' NOT NULL,
	`last_seen_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
