# 0042: A tournament with tables and a queue (round robin, Champions League, Swiss)

## Status

Accepted. Extends [ADR 0008](0008-tournament-model.md) and [ADR 0031](0031-tournament-league-scoring.md);
the classic tournament (rounds of matches) stays as it was.

## Context

Tester feedback (round 6) and the organizer's specification "Turnier-App – Spezifikation Turniermodi"
asked for a tournament that does not wait for rounds: the schedule is fixed from the start, a table that
becomes free gets the next duel at once, everybody ends with the same number of duels, a player who
leaves is made up for, and the standings stay at the top for people who come late. The tester also
asked to replace "Turnier löschen" while a tournament runs by "Turnier (speichern) & beenden", and to
tell "ausgestiegen" (still sees the result, leaves completely) from "aus der Wertung genommen".

## Decision

### Two engines, one tournament

`tournament.engine` is `classic` (rounds and matches, unchanged, every existing tournament) or `queue`.
A queue tournament has its own table `tournament_duel` (no round, no table number that must be unique;
`round` is only the round or Spieltag a duel is shown under), the settings on the tournament
(`queue_mode`, `planned_rounds` = R, `prelaunch`, `tables`, `duel_minutes`), the Swiss pauses
(`queue_pauses`) and on the participant `disqualified` and `drop_option`. Migration 0021 only adds
columns and a table, so a database from before keeps working. New tournaments default to the queue
type; the classic one is a choice in the form.

### The rules live in pure modules

`shared/tournament-*.ts` have no database and no browser, and every rule of the specification is a function
with tests: `modes` (setup check, time estimates, rounds for a wanted duration), `draw` (round robin,
Champions League circle, Spieltag), `matching` (maximum weight matching, a blossom implementation checked
against brute force), `swiss` (pairing as a matching), `duels`, `table`, `queue`, `flow` and `dropout`.
`server/utils/queue-tournaments.ts` only loads the state, calls them and writes the outcome back.

### What is stored, what is calculated

Stored: duels (status `planned`, `running`, `done`, `void`), who won, table and times. Never stored: the
table, the queue, the pool of make-up duels, the options of a dropout. They are worked out from the duels
on every read, so a corrected result changes everything that follows without a second source of truth.

### The queue

Duels are not played in rounds. A duel can start when it is fixed, both players are in no running duel and
a table is free. The next duel is the one whose players have the most duels still open (so nobody is done
after three hours while others have six to play), at a tie the one who has waited longest. A duel is only
chosen if the free tables can all still be filled afterwards (a maximum matching among the playable duels
decides that), so no table stands empty because the best duel blocked two others. The app starts duels by
itself after every result, so the organizer only enters winners. Spieltage are a display.

### The three modes

Round robin: all duels, circle method. Champions League: the players are shuffled once into a circle and
everybody plays the R/2 nearest neighbours on both sides, so every player has R different opponents and
nobody meets twice; R is even and at most n − 1; no pots, never redrawn. Swiss: R about ceil(log2 n), one
more with a head start, then even. Classic Swiss pairs round k + 1 when round k is complete; with the head
start ("Vorlauf") rounds 1 and 2 are paired before the start and round k + 2 as soon as round k is complete,
so the tables never run dry. Every pairing is a maximum weight matching: similar record gets a high
weight, a pair that has met has no edge, the most pairs always come first.

An odd field: one player pauses per round (no win for the pause). Nobody pauses twice while another has not,
the lowest in the table who has not paused is chosen, and the pausers of rounds 1+2, 3+4 … play a make-up
duel against each other. For the pairing only, a pause counts as half a win.

### Tiebreaks and the table

(Replaced by the ladder of [ADR 0044](0044-tournament-ranking-extension-and-table-view.md): points, direct comparison,
difference of the games, games won.)

Wins, then the Buchholz sum (the wins of all opponents), then, for exactly two players, their duel (a
rematch counts both ways, 1:1 goes on). What is left shares a place, and for first place the organizer can
schedule one deciding duel (kind `decider`, which settles the tie whatever the earlier duels were). Players
who left are listed grey, last, without a place, with their record; disqualified players are not shown.

### Leaving: A and B

A dropout is only possible between duels. Option **A** strikes every duel of the player (as if they had
never been there, struck duels stay with status `void`); option **B** keeps the played ones and strikes the
open ones. A disqualification is always A. Everybody who stays must end with the same number of duels, so the
players who lack one are paired in a **pool** by the same matching; a pair that has met needs the organizer's
confirmation. Only options after which this works out are offered:

* round robin and Champions League: the lacking duels have to be pairable, which comes down to an even
  number of open opponents for B; A always works;
* Swiss: A always works; B works when the duels that stay against players who left are an even number.
  (The specification said "B always"; with an odd number one player would be left with a duel nobody
  can match: the duels among the players who stay add up to (n · R − retained) / 2, which is whole only
  when `retained` is even, R being even.)

The decision can be deferred: the duels of the player wait, the queue skips them, until the organizer
decides. In the Swiss system the pool is only paired when both rounds of a pair are paired (the pause of an
odd round is still being made up by the next one).

### "Neu berechnen"

Swiss only: the pairings that have not started are drawn again from the table as it is, with a preview of
what changes. Played and running duels are never touched; a round whose players cannot all be paired
anew keeps what it had.

### Decisions on the open points of the specification

* Tiebreak order: wins, Buchholz, direct duel, shared place (as above).
* Last Swiss round with a head start: paired like any other (round k + 2), nothing special.
* Who enters results: only the organizer; a player sees the table and the queue.
* Who pauses: the lowest in the table among those who have not paused, avoiding the opponents of the
  player who paused the round before so the make-up duel is new.
* Playing ahead one Spieltag: not needed, the queue takes the next playable duel whatever its Spieltag.
* Optional top-4 final: not built.
* Mode recommendation: up to 8 players round robin, up to 24 Champions League, more Swiss.

### Not built (as in the specification)

Time limits, byes as wins, a draw button, Elo or pots, late registration, a Swiss system without rounds, a
world-championship bracket, redrawing after a dropout, deleting duels to equalize, win rate.

## Consequences

* A finished classic tournament and a running queue tournament live side by side; the detail DTO has `queue`
  (null for a classic tournament) and the participant DTO `disqualified` and `dropOption`.
* "Turnier löschen" is not shown while a tournament runs; ending it keeps what was played.
* The estimates are estimates: they assume every duel takes the planned minutes.
