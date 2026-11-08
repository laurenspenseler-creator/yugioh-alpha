# 0044: The ranking ladder, one more Spieltag, the table that can be pinned, decks at creation

## Status

Accepted. Extends [ADR 0043](0043-tournament-spieltage-and-best-of.md) and replaces the tiebreak order of
[ADR 0042](0042-tournament-duel-queue.md) and 0043 (wins, Buchholz, direct duel).

## Context

Tester feedback (round 8, after playing a tournament out):

* "Matchpunkte – direkter Vergleich – Duelldifferenz – gewonnene Duelle. So machen wir das." The table sorted by
  points, wins and the Buchholz sum, which nobody at the table can work out in their head.
* In a best-of-3 duel the buttons were in two rows of two, so "Gero gewinnt 2:0 / 2:1" lay next to each other and
  the buttons of the other player under them. They should be two columns: the player named on the left has his
  buttons on the left, the other one on the right.
* "Das Turnier ist fertig, ich will aber eine weitere Runde spielen." A tournament in which every duel was played
  could only be saved and ended.
* "Die Kombi aus Einzelduell und der Punktevergabe nach Spielen geht nicht." A single game has no score, so the
  scoring by games cannot tell anything apart; the form offered it anyway.
* "Bugt dann auch. Ben wird nicht angezeigt." The pinned table scrolls inside itself (it must not cover the page),
  and the scrolled-off first row looked like a missing player.
* The table should not only be hideable but also pinnable and releasable: follow the reader down the page or not.
* The decks of a player can be written behind the name when the players are typed in: `Anna (Blue-Eyes, Chaos)`;
  comma and slash tell the decks apart.
* "Wir haben hier viel Monster-Sortierung": the inventory (and the catalog) filter by attribute, monster type and
  level, which a Spell or Trap does not have.

## Decision

### The ranking ladder

Each step only decides between the players the one before left level (`shared/tournament-table.ts`):

1. **Points** by the scoring of the tournament. With the classic scoring (3 · 0) they are the match points.
2. **The direct comparison**: the duels among the players who are level on points. Each of them is worth the wins it
   has against the others of that group; a deciding duel (kind `decider`) counts first. For two players that is
   simply who won their duel; for more, who won more of the duels inside the group.
3. **The difference** of the games won and lost over the whole tournament; a single game counts as 1:0.
4. **The games won**.

What is left shares a place, and for first place the organizer can schedule the deciding duel as before. The Buchholz
sum is gone from the table and from the data (`QueueTableRowDto.buchholz` became `gamesWon` and `gamesLost`); the
table shows them as "Partien" (won : lost) and "Diff.". Wins are no longer a tiebreak of their own: with the classic
scoring points are three times the wins, and with the scoring by games the points already say how clean the wins were.
The Swiss pairing still goes by wins.

### Best-of-3 buttons

The four buttons are a grid filled column by column in two rows (`grid-flow-col grid-rows-2`): the player named first
has both of his buttons in the left column, the other player in the right one.

### One more Spieltag

`POST /api/tournaments/:id/extend` (organizer, running duel tournament, every live duel played, else
`schedule_not_over`) adds one Spieltag in every mode and way of playing. The day is paired like a Swiss round from the
table as it stands (`pairSwissRound(state, round, { allowRematch: true })`): players level on points meet, nobody plays
someone they already played unless there is no other way, and then the duel is a `rematch`. After a full round robin
that is the rule: the new day is a return leg. An odd field pauses one player as in any Swiss round. A Swiss
tournament has one round more afterwards (`plannedRounds`). The tournament goes on until the organizer saves and ends
it; it can be extended again. `QueueDetail.canExtend` tells the page whether to offer the button, which sits left of
"Turnier speichern & beenden" and asks first. A tournament that is already ended cannot be reopened.

### Single games and the scoring by games

With "Ein Duell ist: Einzelduell" the scoring select shows the classic scoring (3 · 0), disabled, with the hint that
the scoring by games only exists for best of 3, and the form and the settings send `match` then. The choice that was
made comes back when the duel is best of 3 again. The server accepts both combinations (an API client can still send
`games` with single games; it is worth 3 and 0 there).

### The table: pinned or released, and a hint when it scrolls

The standings table has a "Tabelle anheften" / "Tabelle lösen" button next to "Tabelle ausblenden", kept in the
browser like the hide choice (`ygo-queue-table-pinned`). Pinned (the default) it sticks to the top and scrolls inside
itself; released it is part of the page and shows every player at once. A pinned table that is taller than its box
says so in a line under it, with the way out, so a scrolled-off row is not mistaken for a missing player.

### Decks behind the name

A line of the player list in the creation form is `Name (Deck 1, Deck 2 / Deck 3)`; an e-mail address works as the
name. The brackets may be left open, a deck written twice counts once, at most five decks and 60 characters each (the
limits of ADR 0039). The server adds the decks, as names without a list, in the same transaction as the tournament
(all or none), through the same function that adds a deck to a participant.

### Spells and Traps in the filters

When the "Kartenart" filter holds only Spells and/or Traps, Typ, Attribut and Stufe/Rang step aside and the race menu
becomes "Zauberart", "Fallenart" or "Zauber-/Fallenart" with the subtypes (Normal, Schnell, Permanent, Ausrüstung,
Spielfeld, Ritual, Konter), which the catalog keeps in `race`. Without a Spell or Trap the "Monsterart" menu lists only
the monsters' races; with a mix of both it offers every value as "Art". Changing the kinds takes the values along that
no longer fit, and a value that is still picked stays visible in its menu, so no filter is ever active without
showing. A card facet filter without a kind menu (the format editor) is unchanged.

## Addendum: the same evening, after the first look (feedback "ES fehlen zbsp.")

* **Zauberart: all of them, with the card's symbol.** The inventory's facets only hold what the player owns, so a
  collection without a Field or a Ritual Spell showed neither in "Zauberart". The subtypes of the picked Spells and Traps
  are now the game's own list (`spellTrapRaces`), whatever the facets say. Each carries the symbol of the card frame:
  infinity (Permanent), plus (Ausrüstung), compass (Spielfeld), lightning (Schnell), flame (Ritual), the bent arrow
  (Konter); Normal has none, as on the card (`app/utils/spell-trap-icons.ts`, lucide icons).
* **Match, not Duell.** "Gibt meines Wissens nach mehr als nur 4 Duelle. Sondern eher 4 Matches." What the schedule counts
  (4 per player, 10 in all, "6 von 6 gespielt", minutes per ...) is a match: one game, or best of 3. The interface says
  Match everywhere in the duel tournament (German and English, errors included: Nachholmatch, Entscheidungsmatch,
  Wiederholungsmatch, "Matches pro Spieler"); the single games stay "Partien". Only the wording changed; keys, DTOs and
  the code still say duel.
* **The table.** "Spieltage" is the first number, left of "Siege" (the days the player has played on, `matchdays`: the
  distinct days of their done duels); it replaces "Offen" (the DTO still carries `open`). The decks are centred and
  separated by " / ".
* **Three dots on the tournament cards** (tournament list, organizer only): "Umbenennen" (a dialog, `PATCH
  /api/tournaments/:id`) and "Löschen" (the same confirmation as on the tournament page, `DELETE`). Delete is offered
  for a running tournament too: the rule "no delete while running" belongs to the page, where "Turnier speichern &
  beenden" is the way out; the list is where a test tournament goes. The name and the description of a finished
  tournament can be changed (they are labels); every other setting still answers `tournament_finished`.

## Consequences

* `QueueTableRowDto` loses `buchholz` and gains `gamesWon`, `gamesLost`, `matchdays`; `QueueDetail` gains `canExtend`.
  No migration: everything is computed from the duels.
* Tournaments that exist are ranked by the new ladder from now on (their data does not change).
* Not built: reopening a tournament that was saved and ended; adding a Spieltag while duels are open; a count per
  subtype next to the Spell and Trap chips of the inventory.
