ALTER TABLE `tournament` ADD `flow` text DEFAULT 'queue' NOT NULL;--> statement-breakpoint
ALTER TABLE `tournament` ADD `best_of` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `tournament_duel` ADD `games_a` integer;--> statement-breakpoint
ALTER TABLE `tournament_duel` ADD `games_b` integer;