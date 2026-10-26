# 0038: Card-text filters, exceptions, and what "hand traps" means

## Status

Accepted. Changes one decision of [ADR 0022](0022-classic-plus-format.md) ("the
engine filters on card data, not on card text"), at the owner's request.

## Context

Importing a rulebook ([ADR 0037](0037-format-from-a-rulebook.md)) showed what the
rule engine could not say: tester feedback on the first version of that page was
that "cards that mention Synchro, Xyz, Link or Pendulum in their text" and "cards
that cause an instant win" *are* checkable, since the card text has to say so
("you win the Duel"), and "Empfängermonster" is not an effect class at all but a
card type (German for Tuner). "No hand traps (except Kuriboh)" is the one that is
genuinely about what a card does; Classic Plus already has a definition for it, and
the tester wanted a stricter one, and a way to bring their own.

Classic Plus's rule 2 worked because its banlist was generated from card text
offline. The same check as a live filter reproduces it: 2,923 cards on the real
catalog against the 2,921 of the case-sensitive generation.

## Decision

### `textContains` and `except`

- A card filter gets `textContains: string[]`: the card's **English** text contains
  one of the phrases as whole words, ignoring case and the kind of white space
  ("win the Duel" finds "you win\nthe Duel", "Link" finds "Link-3" but not
  "Linkuriboh"). A phrase is plain text, never a pattern, so a stored format can't
  carry an expensive regular expression. At most 20 phrases. A card without text
  matches none. English only: it is the catalog's canonical text; the German text
  is a translation that may be missing (ADR 0015).
- A `filter` rule gets `except?: CardFilter`: the rule applies to the cards its
  `match` and `filter` select **that `except` does not match**. Rules only ever
  lower a card's limit, so a card can't be freed by another rule; the exception
  has to sit inside the rule it lifts. An empty exception would match every card
  and switch the rule off, so validation drops it.
- `loadCardDataForValidation` loads the card text for the cards of a deck, which
  is all the engine ever evaluates (never the whole catalog), so the cost is a few
  dozen texts per validation.
- The format editor shows both ("Kartentext enthält (Komma = oder)", "Ausnahme:
  Name enthält"); other keys of an exception (card ids) are kept as they are.

### What the importer turns into rules

| Rulebook says | Rule |
| --- | --- |
| Empfänger(monster) / Tuner | `types` of every Tuner type, forbidden |
| cards mentioning Synchro, Xyz, Link, Pendel(ulum) | `textContains` those words (Pendel as "Pendulum"), forbidden |
| Instant Win … (außer X) | `textContains` "win the Duel" / "wins the Duel", forbidden, `except` name contains X |

The rule's name is taken from the rulebook's own words where it has one, so it reads
in the rulebook's language (the label is stored data, not interface copy).

### Hand traps are a decision, not a guess

A hand trap is defined by what an effect does, which the engine can't read. The
importer therefore doesn't invent a rule; the page asks which definition to use
(`POST /api/formats/handtraps`), each with a help circle that shows its definition:

1. **Classic Plus**: the cards the Classic Plus classification put under rule 4
   (negates or prevents an action of the opponent, or removes a card; effects that
   work only in the Battle Phase or against battle damage are allowed). Generated with
   the Classic Plus banlist into `server/utils/classic-plus-handtraps.json` (69 cards).
2. **More restrictive**: every monster whose text says it is used from the hand
   outside the owner's Main Phase, whatever the effect does (about 390 cards on the
   current catalog). Found from the text at request time, so new cards are included.
   It is a heuristic and can have a card too many or miss one; the editor lists the
   cards by name so the user can adjust. It finds the well-known hand traps (Ash
   Blossom, Maxx "C", Effect Veiler, Nibiru, Kuriboh …).
3. **Their own**: nothing is added; the user is asked to write the definition into
   the rulebook and upload it again.

Either list becomes `card_status` rules (`forbidden`, 200 cards each, so the format
stays valid for `validateRuleSet`). The rulebook's exception ("außer Kuriboh") takes
out the card of exactly that name, not every card with it in the name.

## Consequences

- "Cards that mention …" and "instant win" rules are live: they follow the catalog
  (a new card with such a text is covered at once), unlike the Classic Plus banlist.
- Card text is searched in English only. A rulebook phrased for German card text is
  translated by the importer's word list; a phrase the user types has to be English.
- The two hand-trap lists are static and dynamic respectively; a clone of the format
  keeps the cards it was given, it doesn't follow later catalog changes.
- ADR 0022 still holds for the built-in Classic Plus format: its rules 3–11 are
  classified by a model and shipped as a banlist.
