# 0050: Classic Plus: the hand-over of 16 November 2026

## Status

Accepted. Extends [ADR 0045](0045-classic-plus-v3-1.md).

## Context

The rule authors sent "Classic Plus — Änderungen für v3.1, Vollständige Übergabe aller Beschlüsse aus der Arbeitssitzung
(08.–16.11.2026)" with the feedback of round 16: eighteen rule changes (Ä1 to Ä18), ten corrections (K1 to K10), the complete card
list with the rule behind each card (Teil 3), the open gaps (Teil 4), the known errors of the app with a test list (Teil 5) and what
is left to do (Teil 6). It replaces nothing of v3, and it comes with "Hier ergebnis des regel updates".

The app generates its banlist for every card of the catalog from rule hits (classifier output in `classifications.jsonl`, read
by `combine.ts`) and fixes the cards the authors named as `overrides.json` entries with a `maxCopies` (ADR 0045).

## Decision

### The card list is applied in full

`scripts/classic-plus/card-list-v31.json` is the list: 149 cards, each with its limit, the rules of the list's "Regel" column
and a note. `scripts/classic-plus/apply-card-list.ts` puts them into `overrides.json` (fixed limits, the rules as hits), and
`node scripts/classic-plus/combine.ts --allow-missing` makes the banlist. 119 cards are the ones the authors named (the list's
tables: forbidden, the Exodia complex and "Übriges Limit 1", limit 2, "geprüft und unlimitiert"); with the 30 cards of the rules
below the 149 are 29 forbidden, 64 at limit 1, 23 at limit 2 and 33 unlimited. 71 cards moved against the banlist of 8 November,
all of them in the list: 17 from limit 1 to forbidden, 7 unlimited to forbidden, 22 unlimited to limit 1, 12 from limit 2 to 1,
6 unlimited to limit 2, 3 from limit 2 and 2 from limit 1 to unlimited, 2 forbidden to limit 1.

Three names of the list are not the catalog's: "Strahlender Engel" is Shining Angel (German: "Glänzender Elf"), the list of the
June version; "Schwarz Glänzender Soldat – Leg. Schwertkämpfer" is the card of K4; "Grabwächters Spiritualist" is "...Spiritualistin".
`combine.ts` now also applies an override to a Normal Monster (the Exodia parts) and to a Rule 1 card (K1: Chaos-Imperator is on the
banlist as forbidden next to the type filter).

### The rules of the hand-over

* The classifier's rulebook (`.claude/agents/classic-plus-classifier.md`) has the changes: the interpretation clause (Ä16), the
  floodgate with "Umleitung" (Ä6), rule 4 for Spells and Traps with the sharper Battle Phase exception (Ä17, Ä18), rule 6 with
  Mill and Burn (Ä8, Ä14), rule 7 as a rule of the price (Ä9) with clause (e), summon from the Deck (Ä13), rule 8 whoever acts
  (Ä11), the new rule 12, the definition of own costs (LP do not count, Ä10) and the Flip clause (Ä15).
* `shared/classic-plus.ts`: two new steps, `7e` (tiered like 7) and `12`, so a classification can report them.
* Ä2 to Ä5 (the tiers, the chain of named cards, the split of rule 6) were in place since ADR 0045.

### Cards the new rules hit by their wording

The list names only part of what Ä12 and Ä17 reach. Where a card follows from the rule text alone it is applied and flagged
`source: "rule-text"` for the authors to confirm (30 cards, each with "For the rule authors to confirm" in its note and in
`docs/classic-plus-unsichere-karten.csv`):

* **Rule 4 for Trap Cards (Ä17):** every Trap Card whose text lets it be activated from the hand and whose effect negates or removes
  something is forbidden, as Unendliche Unbeständigkeit is: Dominus-Funke, -Impuls, -Spirale, -Säuberung, Lieder der Beherrscher,
  Tachyonen-Transmigration, Taifun, Ausgeglichener Zweikampf, Roter Neustart, Phantasmaspiralschlacht, -kraft, Deltakrähe,
  Schwarzer Schall, Kalliber-Neustart, Harpyien-Federsturm (15). Not forbidden: those that neither negate nor remove (Niederträchtige
  Musterverschiebung, NEXT, Tachyonen-Spiralgalaxie), and Spells (Symbol der Freundschaft is only for the own Main Phase).
* **Rule 12 (Ä12):** alternative win conditions are limited to 1 (Exodius, Schicksalstafel and the four Geisternachrichten, Jackpot-7,
  F.A. Gewinner, Sommer-Hausaufgaben fertig!, Fireworks Celebration, Phantasmaspiralangriff); Letzter Countdown is forbidden (a
  Normal Spell: nothing stays on the field that the opponent could remove); part 2 limits what searches or places the parts of
  Destiny Board by name (Beherrschung des dunklen Geistes, Verhängnisvolle Strafe).

### What is not applied to every card

The rules reach cards the list does not name (every monster that summons from the Deck, rule 7(e), is several hundred; Mill and Burn;
the Flip clause; own costs without LP). A classifier run over the catalog with these rules would be needed (the re-check of ADR 0045
cost about 110,000 tokens for 50 cards); it is not done. The named cards are right, the rest of the list follows the earlier rules.

### Tests

`tests/nuxt/classic-plus-v31.test.ts` reads the card list file: every card is at its limit, the overrides and the list are the same
list, the rule-text cards are flagged, the Exodia complex, Ä17, Ä12, the 7(e) monsters and the test list of Teil 5 (the eighth pair and
the single cases), the steps `7e` and `12`.

## Consequences

* The banlist: 1,895 forbidden, 2,383 limited, 2,011 semi-limited (before: 1,873 / 2,366 / 2,020); 17 more hand traps in the
  handtrap list (92).
* The format's description says "hand-over of 16 November 2026".

## Not built

* The classification of the rest of the catalog by the new rules (above) and a second opinion on the 30 rule-text cards.
* The open gaps of Teil 4 (L6 to L8) are left as the authors left them (theoretical, or worded on purpose).
