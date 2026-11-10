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

## Addendum: the same evening, third look (feedback "Setz normal nach oben")

* **"Normal" leads the subtype menu.** In "Zauberart", "Fallenart" and "Zauber-/Fallenart" the plain Spell or Trap is
  the first entry; the others stay in the order of their names (`CardFacetFilters.vue`). The values and the filter
  itself did not change.
* **A list into a deck that exists.** "Lass mich bei bereits erstellten Decks auch Listen hinzufügen." The deck editor
  has a "Liste hinzufügen" button next to "Karten hinzufügen" and "Teilen". It opens the dialog of "Deck importieren"
  with a `deckId`: the same input (text, `.ydk`, `ydke://`, Omega code, photos, speech) and the same review, but no name
  and no format to choose, and the button says "Zum Deck hinzufügen". The cards go in through the new
  `POST /api/decks/:id/cards/import` (`{ cards: [{ catalog_card_id, section, quantity }] }`, at least one, at most
  `MAX_DECK_CREATE_CARDS`): `addDeckCards` adds each entry's copies to the ones the section already holds, as the
  increment mode of `PUT /api/decks/:id/cards` does one card at a time, but in one transaction. A card that does not fit
  (unknown, a section its type forbids, more than 99 copies) leaves the deck as it was. Copy limits stay warnings, as
  everywhere. A cover from an Omega code is not used (the deck has its own).
* **The format until the start.** "Lass mich vor Start nochmal das Format ändern können." The settings of a duel
  tournament that has not started begin with a "Format" select (no format, the built-in formats by name, then the
  organizer's own), saved with "Einstellungen speichern". The server already allowed it (`PATCH` with `formatId`, only in
  the registration phase, like the scoring); the panel sends `formatId` only when it was changed, and `null` for "Ohne
  Format". A format that is set but not in the list (not the organizer's to assign any more) stays visible in the select.

## Addendum: the same day, fourth look (feedback "Hg hat häufig 2"): the order of the table

* **The difference comes before the direct comparison.** "Hg hat häufig 2:0 gewonnen, das wird nicht gewürdigt. Leute mit
  einer höheren Plus-Differenz sollten oben sein." Three players on 12 points had hg (games 9:4, +5) behind two players
  with +2, because the direct comparison put them first. The ladder is now: points, then the difference of the games,
  then, among the players still level, the direct comparison (`shared/tournament-table.ts`). The direct comparison
  looks only at the duels among the players that are level on points *and* difference.
* **The games won are no tiebreak any more.** "Es ist besser, immer 2:0 zu gewinnen als 2:1. Also mehr gewonnene Duelle
  ist nicht besser." A 2:1 wins one more game than a 2:0 and is the worse win. What is level after the three steps is a
  tie (a shared place, and for first place the deciding duel).
* **A column "Niederlagen"** (the matches lost) next to "Siege". The tester asked to add "gewonnene Duelle und Niederlagen"
  to the table; the games won and lost were already in "Partien", the wins in "Siege", so the missing one is the
  losses. It comes with the DTO (`QueueTableRowDto.losses`) and is hidden on a phone like the other detail columns.
* **Symbols for the attributes** ("Füg bei den Attributen auch die Symbole hinzu"): DARK moon, DIVINE sparkles, EARTH
  mountain, FIRE flame, LIGHT sun, WATER droplet, WIND wind, in the attribute menu of the inventory, the catalog, the
  format editor and the deck editor's add panel (`app/utils/attribute-icons.ts`; the icon set has no emblems of the
  game, these are the closest symbols).
* The league table of the older, classic tournaments (`shared/tournament-standings.ts`) keeps its own tiebreaks; no new
  tournament is made with it.

## Addendum: the next day (feedback "Ich habe 4 Ritual Karten 3 mal macht 12")

* **The table has five columns of numbers: Spieltage, Punkte, Wins, Defeats, Diff.** "Ich brauche nur Spieltage, Punkte,
  gewonnene Duelle (Wins), verlorene Duelle (Defeats) und Differenz." In Yu-Gi-Oh a duel is one game and a match is one or
  three of them, so Wins and Defeats are the games won and lost (`gamesWon`, `gamesLost`; a single game counts as 1:0),
  and Diff is what they leave, the number the ranking uses. This replaces the reading of the last addendum, where
  "Niederlagen" was the matches lost: the columns "Siege", "Niederlagen", "Matches" and "Partien" are gone, and the five
  are shown on a phone too. `QueueTableRowDto.losses` is still sent and no longer shown.
* **A new tournament starts as best of 3** ("Stell Best of 3 als Standard ein"): `NEW_TOURNAMENT_BEST_OF` in
  `shared/tournament-modes.ts` is what the form starts with, and with it the scoring by games. `DEFAULT_BEST_OF` stays a
  single game: that is what the API assumes when a request says nothing, and a request that leaves out `bestOf` must not
  suddenly need the games of every duel.

## Consequences

* `QueueTableRowDto` loses `buchholz` and gains `gamesWon`, `gamesLost`, `matchdays`, `losses`; `QueueDetail` gains `canExtend`.
  No migration: everything is computed from the duels.
* Tournaments that exist are ranked by the new ladder from now on (their data does not change).
* Not built: reopening a tournament that was saved and ended; adding a Spieltag while duels are open; a count per
  subtype next to the Spell and Trap chips of the inventory.
