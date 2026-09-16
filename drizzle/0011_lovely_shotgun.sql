DROP INDEX `segments_episode_sequence_uidx`;--> statement-breakpoint
ALTER TABLE `segments` ADD `source_revision` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `segments_episode_revision_sequence_uidx` ON `segments` (`episode_id`,`source_revision`,`sequence`);--> statement-breakpoint
DROP INDEX `shots_episode_sequence_uidx`;--> statement-breakpoint
ALTER TABLE `shots` ADD `source_revision` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `shots_episode_revision_sequence_uidx` ON `shots` (`episode_id`,`source_revision`,`sequence`);--> statement-breakpoint
ALTER TABLE `assets` ADD `source_revision` integer;--> statement-breakpoint
UPDATE `assets`
SET `source_revision` = COALESCE(
  (SELECT `source_revision` FROM `story_bibles` WHERE `story_bibles`.`project_id` = `assets`.`project_id`),
  1
)
WHERE `asset_type` IN ('character', 'scene', 'prop');
