# 0043: Spieltage, best of 3 and the players named at creation

## Status

Accepted. Extends [ADR 0042](0042-tournament-duel-queue.md); the classic tournament stays as it was. The order of the
table below (points, wins, Buchholz, direct duel) was replaced by the ladder of [ADR 0044](0044-tournament-ranking-extension-and-table-view.md).

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
Champions League, Swiss with or without head start) is independent of it.

A second round of feedback the same night ("Schaff Tische und Plan ab. Gib mir einfach nur den Plan nach Spieltagen. So
haben wir mehr Flexibilität im Turnier an den Tischen und keinen Zwang. Keine Warteschlange." and "Warum kann ich bei der
Turnierart klassisch die Punktevergabe auswählen und sonst nicht, das soll einheitlich sein") settled it: **there is one
kind of tournament in the form**. A new tournament is always played in Spieltage (`flow = rounds`), the form has no
"Turnierart", and every choice is there for everybody: mode, head start, best of 1 or 3, and the scoring (below). Tables
with a queue (`flow = queue`) and the classic engine (rounds of matches) are no longer created from the form; they stay
in the code for the tournaments that exist, which run as before. The API still takes both (`flow`, `engine`), so
the classic tournament can be made there (the e2e tests do) and the way of playing can still be switched until the start
for a tournament made with a queue.

Nothing forces an order in Spieltage: the organizer can enter the result of a duel of a later day before its day has
begun (both players still in the tournament). The gate only decides which duels are shown as running, i.e. the day that
is being played.

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

### The scoring (Punktevergabe)

`tournament.scoring` (`games` | `match`, ADR 0031), until now only the classic tournament's, is a setting of the duel
tournament too, in the form and in the settings until the start. The table is sorted by **points**, then wins, then the
Buchholz sum (the wins of the opponents), then the direct duel. `games`: a win without losing a game 3 points, a win that
lost one 2, a loss with a game won 1, else 0; `match`: 3 and 0. A single game has no score to tell them apart, so it is 3
and 0 either way, which the form says; the choice only matters in a best-of-3 tournament. The Swiss pairing still goes by
wins.

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
* The classic engine and the queue way of playing are not offered in the form any more (see above); the page of a
  running tournament of those kinds is unchanged.
* Not built: hiding the table from the players (it is only folded away on the screen of whoever hides it), a Swiss
  system or Champions League in the classic engine.
