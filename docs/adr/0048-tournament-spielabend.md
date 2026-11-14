# 0048: The Spielabend: duels paired by hand, a best-of for each duel

## Status

Accepted. Adds a mode to the duel tournaments of ADR 0042, 0043 and 0044 (tester feedback, round 15).

## Context

The tester asked for one more game mode: "gib mir noch den spielmodus, spielabend. Da kannst du normal teilnehmer
anmelden und n format auswählen. Hast aber keinen spielplan, sondern die möglichkeit aus den teilnehmern (dropdown menü)
duelle zu paaren und ergebnisse einzutragen, du kannst in dennen einzeln auswählen ob einzelduell oder best of 3."

Every mode so far has a plan: the schedule is drawn at the start (round robin, Champions League) or round by round
(Swiss), and the app starts the next duel. A game night works the other way round: the people who are there decide who
plays whom, when they like.

## Decision

* **A fourth mode, `free` ("Spielabend")** next to round robin, Champions League and Swiss (`shared/tournament-modes.ts`,
  `isFreeMode()`). It is chosen where the mode is chosen: in the new tournament form and in the settings of a tournament
  that has not started. It has a format, players and a scoring, and nothing else to set: no rounds, no tables, no
  minutes per match, no head start. `validateSetup` only asks for two players. Like every new tournament it is played
  in "rounds" (no tables, no queue); the flow is forced to that.
* **No schedule.** `startingSchedule` fixes no duel and no pause, `targetDuels` is 0, so nobody lacks a duel, nothing is
  made up when a player leaves, no deciding duel is asked for after a tie and no remaining time is estimated
  (`remainingMinutes` null, `canExtend` false). The "Matches pro Spieler" field and the time estimate are not shown.
* **The organizer pairs the duels** (`TournamentsQueueFreeBoard`): two drop-downs with the players who have not left
  (someone who is in a duel right now is listed greyed out, the player chosen in one menu is missing from the other),
  "Gespielt wird" (Einzelduell or Best of 3) and "Duell starten". The duel starts at once, at the lowest table number
  that no running duel has; the same two may play again once their duel is in. Nobody can be in two duels at the same
  time (`player_in_duel`).
* **The best-of belongs to the duel, not to the tournament.** `tournament_duel.best_of` (migration 0023, null for every
  duel of the other modes, which take the best-of of the tournament). The result form of a duel asks for the score
  (2:0 or 2:1) when its own best-of is 3 and for the winner alone when it is 1; the server checks it against the same
  value. The best-of of the tournament is then only what a new duel starts with in the form. It stays set when a duel is
  started, because an evening is mostly one kind of duel.
* **Scoring** is the one chosen for the tournament, and the scoring "nach Spielen" stays available although a new duel
  may be a single game: a best-of-3 duel scores 3/2/1/0 by its games and a single game 3:0. The table sorts as in
  ADR 0044: points, then the difference of the games, then the direct comparison.
* **Take back a duel** that was paired by mistake (`DELETE /api/tournaments/:id/free-duels/:duelId`, "Zurücknehmen"), but
  only one that has no result yet (`duel_not_open`); a played duel is corrected like in every other mode.
* **API:** `POST /api/tournaments/:id/free-duels` `{ participantAId, participantBId, bestOf }` (organizer only, only for
  a running Spielabend: `not_free_tournament`, `tournament_not_running`, `invalid_pair`, `invalid_best_of`,
  `player_in_duel`). Both answer with the tournament detail, like every other action.
* The detail DTO carries `bestOf` on every duel (`QueueDuelDto`); the progress line reads "3 Duelle gespielt" instead of
  "x von y Matches gespielt", because there is no total.

## Consequences

* A tournament in this mode ends when the organizer says so ("Speichern und beenden"); nothing is ever "finished" by
  itself.
* A player who leaves a Spielabend simply leaves the list of players; the duels they played keep counting (option B) or
  are struck (option A) as in every mode.
* Not built: a player who is not the organizer cannot propose a duel; a table plan or a limit of tables for the evening.
