# Classic Plus v3.1: re-check a batch of cards

You re-check Yu-Gi-Oh! catalog cards against the Classic Plus format and add what the rule authors' v3.1 change block
asks for: the traits that decide whether a limit is 1 or 2 (ADR 0045). You record hits and traits; a script computes
the limits. You do not decide a limit yourself.

## Read first

1. The rules (rules 3 to 11, the glossary and the notes) in `.claude/agents/classic-plus-classifier.md`, from the
   heading "Rules" down. Rule 8 also applies to Extra Deck monsters.
2. The owner's rulings in `scripts/classic-plus/rulings.md`. They take precedence over your own reading.

Judge by the card text in the input only, not by what you remember about the card or its role in the metagame.

## Input

The prompt gives you an input path and an output path. The input is JSONL, one card per line:

```json
{"id": 12345, "name": "…", "type": "Effect Monster", "frameType": "effect", "race": "…", "attribute": "…", "level": 4, "desc": "…", "oldHits": [{"rule": "8", "quote": "…", "repeatable": false}], "oldUnsure": false, "namedCards": ["Necrovalley"]}
```

`oldHits` is what an earlier classification found. Re-check it: keep a hit unless it is clearly wrong under the rules and
the rulings, and add a hit that was clearly missed. If you drop or add a rule, start `note` with `CHANGED:` and say why.
`namedCards` are the quoted names in the text that are the exact name of a card in the catalog (an archetype is usually
not among them); it helps with the chain of named cards below.

## What v3.1 adds: tiers

The base limit of the rules 5, 6(b), 7 and 8 is 1. Traits move it, one hit at a time:

* **`body`** (angreifbarer Körper): while its effect works, the card has something on the field that the opponent can
  remove or overwrite with regular means of the game. A monster whose effect is used from the field: its own body. A monster
  whose effect is used from the hand or the GY: no body, unless the effect puts a card on the field that the effect then
  depends on. A Field Spell can be overwritten by the opponent's Field Spell: body. A Continuous Spell or Trap, or a
  one-shot Spell or Trap, that only goes away through targeted Spell/Trap removal: no body (as in rule 3, step 2). A
  one-shot effect that leaves a monster behind on the field (a revived or stolen monster): that monster is the body.
* **`cost`** (Eigenkosten): every use of the effect costs the player a card of their own, LP, a Tribute or a
  Summon. A free choice among many does not make it cheaper: discarding or sending 1 card, paying LP, Tributing, banishing
  or sending your own cards as the price all count. So does a price the effect itself brings along for the player: taking
  damage because of it, or having their own monsters destroyed or banished at the end of the turn. Something the effect does
  to the opponent does not.
* **`noanswer`** (keine echte Antwort): the card has no real answer, which brings the limit back to 1 whatever else is
  true: its body is unconditionally protected from card effects (rule 9(a): cannot be destroyed by card effects, or
  cannot be targeted, or is unaffected, with no condition on the text); or its lock makes the answer to it worthless
  (rule 3, check step 2b: dealing with the card does not remove the lock, or the answer triggers the effect);
  or the card brings itself back onto the field (from the GY or the banishment). A revival by *another* card does not count,
  or every monster would have it. Also no real answer (ruling 38): the text says that neither player (or the opponent) can
  activate cards or effects in response to this card's or this effect's own activation (Super Polymerization). Not enough:
  only the targeted cards cannot respond, or something that lasts after the activation.
* **`bound`** (rule 5 only): the draw is paid with a card that is bound to one specific card, not freely chosen. "Send 1
  Monarch Spell/Trap from your hand" is bound; "discard 1 card" is not.
* **`chain`** (any rule, Bedingungskette): the card's effect only works while a *named* second card is on the field (a
  card whose exact name the text gives, not an archetype), and the opponent can get rid of that card or its bearer by
  battle, by overwriting the Field Zone or by a removal that does not destroy. An archetype ("a monster of this archetype")
  is no chain: it refills itself in the owner's own deck.

How a script reads them (so you only record them): rule 5: `bound` gives 2. Rules 6(b), 7(a) to 7(d), 8: `noanswer`
gives 1, else `body` or `cost` gives 2, else 1. `chain` is one step milder after that, at most limit 2.

Record only traits the text supports. Leave `traits` empty when none applies. Do not put `body`, `cost` or `noanswer`
on a hit of any other rule, and do not put `bound` anywhere but rule 5.

## Output

Write the output file as JSONL, exactly one line per input card, in input order, with no other text:

```json
{"id": 12345, "hits": [{"rule": "8", "quote": "destroy all monsters your opponent controls", "repeatable": false, "reason": "mass removal", "traits": ["body", "cost"]}], "unsure": false, "note": ""}
```

* `hits`: every rule the card hits, possibly none. `rule` is one of `3.1`, `3.2`, `3.3`, `3.4`, `4`, `5`, `6a`, `6b`, `7a`,
  `7b`, `7c`, `7d`, `8`, `9a`, `9b`, `10`, `11a`, `11b`, as in the rules.
* `quote`: a verbatim substring of `desc` (exact characters, no paraphrase, no ellipsis). Keep it short.
* `repeatable`: as in the rules (the frequency modifier): `true` only for an activated effect that one copy can activate more
  than once in the same turn.
* `reason`: one short English sentence.
* `traits`: a list from `body`, `cost`, `noanswer`, `bound`, `chain` as above, possibly empty.
* `unsure`: `true` when the text is ambiguous or you hesitated between two outcomes (also for a trait); say why in `note`.
  Prefer flagging to guessing, a human reviews the flagged cards.

Check your file before you finish: as many lines as the input, valid JSON on every line, every quote a substring of its
card's `desc`.
