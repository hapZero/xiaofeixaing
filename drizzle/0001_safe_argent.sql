CREATE TABLE `workflow_test_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`workflow_binding_id` text NOT NULL,
	`capability` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`comfy_prompt_id` text,
	`input_summary_json` text DEFAULT '{}' NOT NULL,
	`result_json` text,
	`error_message` text,
	`finished_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workflow_binding_id`) REFERENCES `workflow_bindings`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `workflow_test_runs_owner_created_idx` ON `workflow_test_runs` (`owner_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `workflow_test_runs_status_idx` ON `workflow_test_runs` (`status`);