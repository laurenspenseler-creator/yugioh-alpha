# 0043: Spieltage, best of 3 and the players named at creation

## Status

Accepted. Extends [ADR 0042](0042-tournament-duel-queue.md); the classic tournament stays as it was.

## Context

Tester feedback (round 7, after the first real use of the duel queue):

* "Ob ich Runden oder Tische mit Warteschlange habe, sollte kein Unterschied in den Auswahlmöglichkeiten
  machen." In the form, "Mit Runden" was the classic engine (Swiss and round robin only, no Champions League,
  no head start) and "Mit Tischen und Warteschlange" the duel queue, so the modes depended on the type.
* "Ich hab lieber ein paar Spieltage als immer wieder Warteschlange. Lass das mit den Tischen weg und mit
  der nächsten Liste, mach einfach nur Spieltage."
* Best of 3 or a single duel has to be chosen, in every mode, before the start.
* Hide the table, show the decks in it, add the players already when the tournament is created.
* "Die Einstellungen konnten nicht gespeichert werden" after changing only the minutes per duel.

## Decision

### The way of playing is a setting of the duel tournament

`tournament.flow` is `queue` (tables and a queue, ADR 0042) or `rounds` (Spieltage). The mode (round robin,
Champions League, Swiss with or without head start) is independent of it, so both ways offer the same choices.
The form's "Turnierart" lists three entries: *Mit Tischen und Warteschlange*, *Mit Runden (Spieltage)*, and
*Klassisch (Runden mit Punkten)*, which is the classic engine unchanged (points, byes, its own settings) for
everybody who wants it.

With Spieltage the planner works with a gate (`planQueue(..., byRound)`): a duel starts only when every duel of an
earlier day is over, and the tables limit nothing (the planner gets as many tables as there are players). The day
is the `round` every duel already has (the circle method for the round robin, the Champions League draw, the Swiss
round), so a Swiss tournament with a head start has rounds 1 and 2 drawn at the start but plays one day at a time.
The page then shows no tables and no "Als Nächstes" list, only the days, the current one open; the table says "Spielt"
instead of a table or a place in the queue; the estimate is the number of days times the minutes of a duel, and the
time left counts the days that are not over. The tables field is not asked (and not checked) in this way of playing.

### Best of 3

`tournament.best_of` is 1 or 3 and, like the way of playing and the mode, can be changed until the start. In a
best-of-3 tournament a result is entered as a score: the winner has two games, the other none or one (`games_a`,
`games_b` on the duel, null for a single game). The server refuses a score that does not add up (`invalid_games`) and
stores no score for a single game. Standings are unchanged (wins, Buchholz, direct duel); the score is shown with the
duel. "Minutes per duel" is the length of the whole match.

### Smaller changes

* The table can be folded away ("Tabelle ausblenden"); the choice is kept in the browser (localStorage), for every
  tournament. It is a display setting, not a secret: the data is still sent to the players.
* The table shows the decks of each player (ADR 0039) next to them from medium screens up.
* The creation form takes the players, one name per line or the e-mail address of an account. The server adds them in
  the same transaction as the tournament, so a name that is taken or an address without an account creates nothing.
* The deck's "Zum Inventar hinzufügen" is also an entry of the "..." menu of the deck page (the button stays) and says
  "Inventar", as the navigation does.
* The wishlist takes a list of card lines like the quick entry: they are matched with the same endpoint, shown for a
  check, and only recognised cards that are not on the wishlist yet are added (a card already there keeps its amount
  and note; the add endpoint overwrites both).

### The save error

`UInput type="number"` hands over a number once something is typed (and `''` while it is empty), although its type says
string. The settings panel read the fields with `raw.trim()`, so typing in any number field threw a `TypeError` before the
request was sent (the estimate went stale too, because the computed that reads the fields threw while rendering). The
message shown was the fallback for an error without a server code. The fields are read through `String(...)` now, in the
settings panel and in the form for a classic tournament (planned rounds), with component tests that type into the fields.

## Consequences

* Migration 0022 adds `tournament.flow`, `tournament.best_of`, `tournament_duel.games_a` and `games_b`, all with
  defaults, so every tournament that exists keeps its queue and single games.
* The planner has one more parameter; without it nothing changes.
* The classic engine is still created from the form (as "Klassisch"); it has no best of 3 of its own (its matches
  already carry game scores).
* Not built: hiding the table from the players (it is only folded away on the screen of whoever hides it), a Swiss
  system or Champions League in the classic engine.
