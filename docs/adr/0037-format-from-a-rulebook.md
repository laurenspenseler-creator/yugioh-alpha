# 0037: A format is created from a written rulebook, and the app says what it can check

## Status

Accepted. Since [ADR 0038](0038-card-text-filters-and-handtrap-definitions.md) the
engine can filter on card text, so "cards that mention Synchro …", "instant win" and
"Empfängermonster" (Tuner) are rules and no longer listed as not checkable, and
"hand traps" is a decision the user takes on the page. What remains unsupported are
effect classes (floodgates, damage, mass removal …) and things outside the deck
(sleeves).

## Context

House formats come as a PDF or a message: "Main Deck 40–50, no Synchro, Xyz,
Link, Pendulum, cards with an effect limited to one, no hand traps …". Typing
that into the format editor rule by rule is slow, and, worse, it is easy to
overlook that half of such a text can't be enforced by the rule engine at all.
Two real examples were used to shape this: a friend's "Origin Legacy" and the
"Classic Plus" rules.

The engine checks what a card *is* (type, attribute, race, level, ATK/DEF, set,
name, release date, effect or no effect) and never what it *says* (ADR 0022).
"No hand traps", "no floodgates", "cards that mention Synchro in their text"
are therefore out of its reach, and a format that silently ignores them would
look stricter than it is.

## Decision

### Read the text, don't ask a model

`shared/format-rulebook.ts` reads a rulebook with fixed rules and word lists, in
German and English: deck sizes (range, maximum, minimum, "no Side Deck"), copies
per card, "Extra Deck: Fusion only", forbidden Synchro / Xyz / Link / Pendulum
monsters and Gemini, "cards with an effect limited to Nx", the banlist named
(TCG, OCG, GOAT, Edison, Classic Plus), and lists of card names (under a
heading, or `Forbidden: A; B`). The same text always gives the same format, it
works offline in the desktop app, and nothing leaves the machine. A language
model could read looser text, but then the result changes between runs and the
statement "this is what I understood" can't be trusted; it may be added later
as an optional step in front of this reader.

Every sentence that the reader handles yields a *finding* with a status:

| Status | Meaning |
| --- | --- |
| `applied` | became a rule the engine enforces |
| `unsupported` | the engine can't check it; the finding has a `code`, and the page shows a reason and what to do instead |
| `description` | game flow (life points, turn order, "best of 3"): not a deck rule, kept in the format's description |
| `info` | a remark, such as "this format is built in already" |

A sentence that matches nothing and is long enough to be a rule is reported as
`not_understood` rather than guessed at. What the reader calls unsupported is
deliberately specific: card text mentions, hand traps, instant wins, receiver
monsters, sleeves, and every numbered rule block about what a card *does*
("3 — FLOODGATES"). An "except Kuriboh" in the sentence is carried along.

### Card names become ids on the server

`server/utils/format-import.ts` resolves named cards with the catalog matcher of
the quick capture, in English or German. Only an exact name or a score of 0.9 and
above counts, so a wrong card is never banned silently; names that were not found
are listed (`card_names_missing`). Each rule goes through the engine's own
validation alone, so one bad rule costs only itself.

### PDF text

`POST /api/formats/analyze` takes a PDF (multipart `file`, up to 5 MB, 60 pages)
or `{ text }`. The PDF's text is read by `unpdf` (pdf.js without a canvas) and put
back into printed lines by position (`server/utils/pdf-text.ts`). There is no OCR:
a scanned PDF answers `pdf_no_text` and the page suggests pasting the text. The
endpoint saves nothing.

### The page

`/formats/new` has "Aus PDF oder Text erstellen" above the editor. The result is
shown in groups (what the app enforces, what it can't check and why, what it
didn't understand, game flow, remarks) with the sentence each finding comes from,
and the editor below is filled with the rules, the name and the description, so
the user reviews, corrects and saves exactly like a hand-made format. Messages are
catalogue keys per finding code (`formats.pdf.finding.<code>.text` and, for
`unsupported`, `.why`), tested for completeness in both languages.

## Consequences

- The two example rulebooks are test fixtures (`tests/nuxt/fixtures/rulebooks`),
  extracted from their PDFs; the reader is checked against them rule by rule.
- A rulebook phrased in a way the reader doesn't know produces fewer rules and
  more `not_understood`, never wrong ones; new phrasings are added as detectors
  with a test.
- "Classic Plus" is recognised as a built-in format (`info`), because the built-in
  version carries a generated banlist a text can't express.
- The `unsupported` list is also a to-do list for the engine: if a restriction
  appears in many rulebooks, it is a candidate for an engine feature (ADR 0022).
