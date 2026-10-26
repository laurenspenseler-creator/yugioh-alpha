CREATE TABLE `tournament_participant_deck` (
	`id` text PRIMARY KEY NOT NULL,
	`participant_id` text NOT NULL,
	`tournament_id` text NOT NULL,
	`name` text NOT NULL,
	`deck_id` text,
	`deck_snapshot` text,
	`deck_legal` integer,
	`deck_issue_count` integer,
	`position` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`participant_id`) REFERENCES `tournament_participant`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tournament_id`) REFERENCES `tournament`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`deck_id`) REFERENCES `deck`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_tournament_participant_deck_participant` ON `tournament_participant_deck` (`participant_id`,`position`);--> statement-breakpoint
CREATE INDEX `idx_tournament_participant_deck_tournament` ON `tournament_participant_deck` (`tournament_id`);
--> statement-breakpoint
-- ADR 0039: every participant that had a registered deck keeps it, as the first
-- (and only) deck of the new table. The old columns on tournament_participant
-- stay in the table but are not read any more.
INSERT INTO `tournament_participant_deck` (`id`, `participant_id`, `tournament_id`, `name`, `deck_id`, `deck_snapshot`, `deck_legal`, `deck_issue_count`, `position`, `created_at`)
SELECT lower(hex(randomblob(16))), `id`, `tournament_id`, coalesce(json_extract(`deck_snapshot`, '$.name'), ''), `deck_id`, `deck_snapshot`, `deck_legal`, `deck_issue_count`, 0, `updated_at`
FROM `tournament_participant`
WHERE `deck_snapshot` IS NOT NULL;