# 0045: Classic Plus v3.1: the card list and Rule 8 for the Extra Deck

## Status

Accepted. Extends [ADR 0022](0022-classic-plus-format.md).

## Context

The rule authors sent an "Änderungsblock zu v3" (Classic Plus, Regelwerk v3.1, 8 November 2026) "for the adoption in
Yugi Alpha". It holds five changes to the rulebook (Ä1 to Ä5), seven corrections (K1 to K7) and the resulting changes to
their card list, with the card texts checked against the official German database.

What the app implements is the "Testfassung" of the rulebook plus the owner's rulings
(`scripts/classic-plus/rulings.md`), not v3: the change block assumes v3, which the app does not have, and v3's text was
not part of what we got. The app also works differently from the authors' list. They judge a few dozen cards by hand;
the app classifies every card of the catalog (7,400 candidates) by rule hits and generates the banlist from them.

## Decision

### The card list is authoritative

Every card the block names gets its v3.1 limit as a fixed value: an entry in `scripts/classic-plus/overrides.json` with
`maxCopies` (0 to 3) and a note. `combine.ts` uses `maxCopies` as the card's final limit whatever its hits say; the
hits stay as the reasons (they show in `review.csv`). 32 cards:

* Moved: Regenbogen-Neos 2, Elementar-HELD Absoluter Nullpunkt 1, Grabwächters Übernatürlicher 2 and Pharaonengräber im
  Tal der Toten 2 (both were missing), Blauäugiger Chaosdrache 1, Feuerkönig Hochavatar Garunix 1, Millenniumäugiges Opfer
  1, Tausendäugiges Opfer 1, Schwarz Glänzender Soldat - Legendärer Schwertkämpfer 1 (K4), Dunkler Magier der Zerstörung 2,
  Der Chaosschöpfer 2, Chaos-Imperatordrache - Gesandter des Endes 2, Pinguinsoldat 2.
* Kept, now covered by a rule: Kraftbündnis, Begrenzer-Entferner, Pantheismus der Monarchen, Möbius der Frostmonarch,
  Schicksals-HELD - Destroyer Phoenix Enforcer, Marshmallon, Großer Shogun Shien, Tal der Toten, Verborgene Tempel im Tal
  der Toten, Maskierter HELD Dunkles Gesetz: all 2.
* Kept at 1 and checked: Chaosbetrüger, Seelendiener, Tollkühne Gier, Ookazi, Gehirnkontrolle, Blauäugiger alternativer
  ultimativer Drache (K3: rule 8 is part of its reasons), Neo-Blauäugiger ultimativer Drache (K2: rule 10, it has no
  protection). Ring der Zerstörung stays unlimited, Grabwächters Diener forbidden.
* K1: "Chaos-Imperator, der Drache des Armageddon" is a Pendulum monster; the format's rule 1 filter
  (`Pendulum Effect Monster`) already forbids it, so it needs no entry.
* K5: "Zwillingswirbelsturm" has no entry to strike: the app has no list of names, and the card of that name does not
  exist in the catalog (the German database does not know it either). K7: the card is named Gehirnkontrolle in the app.

An override may now also name a card no pattern matched (route `clear`), which is how Kraftbündnis gets its limit.
`tests/nuxt/classic-plus-v31.test.ts` checks the table against the generated banlist and against the overrides.

### Ä1: Rule 8 reaches the Extra Deck

The exemption "Regel 8 gilt nicht für Extra-Deck-Monster" is gone. `combine.ts` no longer drops rule 8 for Fusion
Monsters, the prefilter no longer leaves them out of the candidates, and the classifier's rule text says so.

The 141 Fusion Monsters whose text matches the rule 8 pattern were reviewed by hand against the rule (the card can remove
more than 1 card of the opponent from the field in one resolution; what the player gives as cost or material does not
count); 62 hit it and carry a rule 8 hit with a quote of the card text in `classifications.jsonl`, the others were
recorded without a hit. A hit is Limit 1 like every rule 8 hit, so most of them were unlimited before. Four hits are
flagged "unsure" (Sprind der Eisenspurt-Drache, Clown Crew Diabolo, First of the Dragonlords, Mirror Force Dragon).
Mirror Force Dragon has no once-per-turn limit and can destroy all of the opponent's cards each time one of the
player's monsters is targeted, so the frequency modifier forbids it.

### Ä2 to Ä4: tiers only for the named cards

Ä2 (Limit 2 for an attackable body or own costs, back to 1 when the card has no real answer), Ä3 (a draw card with a
cost bound to one specific card) and Ä4 (one step milder for a chain of named cards) are judgements about what a card
does on the field. They are applied to the cards the block names, through their fixed limits, and to nothing else.
Ä5 (rule 6 split into 6(a) flat and 6(b) with the tiers) matches the steps `6a` and `6b` the app already had.

All other cards keep the base limit of their rule steps. That is the limit the block calls the "Grundstufe", so the
generated list is a stricter reading than v3.1 for the cards whose body or costs would lift them to 2: about 3,000
cards hit rule 5, 6(b), 7 or 8. Applying the tiers to all of them needs the classifier to also report body, costs and
the "no real answer" traits for those cards, and v3's text to calibrate against; see "Not built".

### Regenerating also picked up the catalog

The banlist was last generated on 18 October. Running the pipeline again reads today's catalog:

* 17 ids of the old list are no longer in the catalog and dropped out.
* 8 cards whose text now mentions Synchro, Link or Pendulum are forbidden by rule 2 (e.g. Marincess Azuri).
* 88 candidates had no classification for their current text: 46 new cards and 42 whose text changed. All 88 were
  classified by hand against the current text and the owner's rulings (70 hit at least one rule; the note on each says
  so). The 42 changed ones kept their limit; of the 46 new cards 35 are limited and 4 forbidden (Super Critical, Silent
  Magician the Silent Fighter, and the two new hand traps Heretic Eradicator and The Secret Crane Princess Who Returns A
  Favor, which also joined the handtrap list of the "Classic Plus definition"); the others hit nothing. Cards with a
  limit that can be used again within a turn (Super Critical, Trirealm Rift Judgment, Reversal Box, Silent Magician's
  draw) are marked "repeatable", which the frequency modifier turns into a ban; 13 of the hand-classified cards are
  flagged "unsure" for review (`review.csv`).

## Consequences

* 44 cards moved in the banlist for v3.1 (the card list and rule 8 for Extra Deck monsters: 1 from forbidden to
  limited, 12 from limited to semi-limited, 3 from semi-limited to limited, 25 from unlimited to limited, 2 from
  unlimited to semi-limited, 1 from unlimited to forbidden), and 25 more through the catalog drift above (17 dropped, 8 newly
  forbidden by rule 2); then 39 more when the 88 unclassified candidates were classified (see above). Two hand traps
  joined the handtrap list.
* The card list is the final word for 32 cards. If the classifier or a ruling later disagrees with it, the card list
  wins until the rule authors change it.
* The format description in the app (`formats.classic-plus.description`) still holds: it names the rule families, not
  their numbers.

## Not built

* The tiers for the other ~3,000 cards (Ä2 to Ä4), which needs a classifier run with trait output and the text of v3.
* The block's open questions: whether a third attack is a multiplication in 6(b), the German name of Gravity Bind, the
  name "Anmutige Barmherzigkeit" (also not in the German database), Pinguinsoldat checked against the database, and
  three rules of the June version that v3 no longer holds (receiver monsters, Gemini monsters, the Flip monster rule).
