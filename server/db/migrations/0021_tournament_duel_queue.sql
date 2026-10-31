CREATE TABLE `tournament_duel` (
	`id` text PRIMARY KEY NOT NULL,
	`tournament_id` text NOT NULL,
	`participant_a_id` text NOT NULL,
	`participant_b_id` text NOT NULL,
	`round` integer NOT NULL,
	`kind` text DEFAULT 'regular' NOT NULL,
	`status` text DEFAULT 'planned' NOT NULL,
	`winner_participant_id` text,
	`table_number` integer,
	`position` integer NOT NULL,
	`started_at` integer,
	`ended_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tournament_id`) REFERENCES `tournament`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`participant_a_id`) REFERENCES `tournament_participant`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`participant_b_id`) REFERENCES `tournament_participant`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`winner_participant_id`) REFERENCES `tournament_participant`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_tournament_duel_tournament` ON `tournament_duel` (`tournament_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_tournament_duel_participant_a` ON `tournament_duel` (`participant_a_id`);--> statement-breakpoint
CREATE INDEX `idx_tournament_duel_participant_b` ON `tournament_duel` (`participant_b_id`);--> statement-breakpoint
ALTER TABLE `tournament` ADD `engine` text DEFAULT 'classic' NOT NULL;--> statement-breakpoint
ALTER TABLE `tournament` ADD `queue_mode` text;--> statement-breakpoint
ALTER TABLE `tournament` ADD `prelaunch` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `tournament` ADD `tables` integer;--> statement-breakpoint
ALTER TABLE `tournament` ADD `duel_minutes` integer;--> statement-breakpoint
ALTER TABLE `tournament` ADD `queue_pauses` text;--> statement-breakpoint
ALTER TABLE `tournament_participant` ADD `disqualified` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `tournament_participant` ADD `drop_option` text;