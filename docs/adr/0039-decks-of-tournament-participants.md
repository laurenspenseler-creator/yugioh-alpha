# 0039: Several decks per tournament participant, set by the organizer

## Status

Accepted. Extends [ADR 0008](0008-tournament-model.md).

## Context

A participant had at most one registered deck, and only a player with an account
could register it for themselves; the organizer could only register a deck for a
guest, from the organizer's own decks. Tester feedback (round 2) asked for the
organizer to enter decks for everyone (guests, players with accounts, themselves),
for players to have several decks, for a deck to be just a typed name, and for the
deck names to be shown in the middle of each row with a bold slash between them.
(Photo-based deck entry came with [ADR 0040](0040-on-device-photo-and-speech-input.md).)

## Decision

### A table of decks per participant

`tournament_participant_deck` (id, participant, tournament, name, deck id, snapshot,
legal, issue count, position, created). A row is either a **frozen decklist** (the
snapshot, copied from one of the app's decks and checked against the tournament's
format, exactly as the single deck was) or **a name only** (no snapshot, no verdict).
At most five per participant (`MAX_DECKS_PER_PARTICIPANT`), the same deck once.

Migration 0020 copies each participant's former deck into the new table. The old
columns on `tournament_participant` stay, unused: SQLite can only drop a foreign-key
column by rebuilding the table, which the migrator would run as one transaction with
foreign keys on, cascading to every match (the reason for the hand-written migration
0017).

The participant DTO has `decks` instead of the single deck's fields. A caller who
may not open the list (everyone but the organizer and the row's owner, before the
tournament is finished) still gets the name, that a list exists and the verdict; not
the list and not the deck id (#3).

### Who may set decks

| Caller | Row | Decks to choose from | Until |
| --- | --- | --- | --- |
| organizer | guest, or the organizer's own | the organizer's decks | the tournament is finished |
| organizer | another player with an account | the decks that player **shared** with the organizer | finished |
| player | their own | their own decks | the registration phase ends |
| anyone above | any row they may manage | a typed name, always | as above |

The organizer may also correct decks while the tournament runs (a deck check, a
late change); a player may not, as before.

A deck stays private until its owner shares it (ADR 0005, sharing). Being added to a
tournament by an e-mail address is not that consent, so the organizer picks only from
what the player shared, and otherwise types a name. If testers want the organizer to
see all decks of a player they invited, that would need an explicit permission of
the player (for example when they accept the invitation), not a change here.

### API and page

`POST /api/tournaments/:id/participants/:pid/decks` (`{ deckId }` or `{ name }`),
`DELETE …/decks/:entryId`, `GET …/deck-options` (`{ source: 'own' | 'shared', items }`).
The old `PUT …/deck` is gone. In the participant list the deck column is centered,
names are told apart by a bold slash, "Kein Deck" is a link for whoever can manage
decks, and one dialog ("Decks von …") lists, adds and removes.

## Consequences

- Results, pairings and standings never read decks; nothing there changed.
- A name-only deck can't be checked; the list shows it without a badge.
- The deck check by photo (a guest's deck, before the start and any time the organizer
  may manage decks) goes through the app's deck import: the dialog "Decks von …" has
  "Deck aus Fotos, Sprache oder Liste anlegen", which creates a deck in the caller's
  account (named "Deck von <participant>", reviewed first) and adds it like any chosen
  deck, with the format check.
