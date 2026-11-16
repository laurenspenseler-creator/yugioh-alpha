# 0051: Exporting the inventory as Excel, Word or text

## Status

Accepted.

## Context

Request of 16 November 2026: "bau die funktion das karten inventar zu exportieren, als excel oder text oder word". The inventory
could be read into the app (quick entry, files, [ADR 0034](0034-card-list-from-spreadsheet.md)) but not written out again. The
deck export (`DeckExportMenu.vue`) already builds its files in the browser.

## Decision

* **A menu "Exportieren"** in the line above the cards (`InventoryExportMenu.vue`), beside "Auswählen", with the three formats.
  It exports **what the list shows**: the same collection, search text and filters (kind, type, attribute, monster type, level,
  Deckthema, format and legality), with **every page**, not the 20 or 24 cards on the screen. The menu says so in a hint line, and
  a file made from a filtered list says "nur die Treffer der Suche" under its title. It is switched off when the list is empty.
* **The server sends rows, the browser writes the file.** `GET /api/inventory/export` takes the query of `GET /api/inventory`
  (page, page size and sort are ignored) and answers `{ items, truncated }`: one row per card and collection, the stored English
  values and both names, ordered like a document: collection by name (the copies without one last), then the card's name in the
  card language. It is limited to 20,000 rows; a bigger inventory gets the first ones and a warning (`truncated`). The query is
  the list's (`ownedCardWhere` in `server/utils/inventory.ts`), so the file always holds the same copies as the list.
  The words (card type, attribute, "Stufe 7", the column heads) come from the browser's i18n, so the file is in the language
  of the app and the cards in the card language ([ADR 0015](0015-german-card-data.md)), like the deck export.
* **No library.** An `.xlsx` and a `.docx` are zips of XML parts; `shared/inventory-export.ts` writes them with `fflate`, which the
  spreadsheet import already uses. The encoders are pure (a document in, bytes or text out).
  * **Excel:** one sheet "Inventar", a header row (bold, grey, frozen, with a filter), one row per card and collection: Anzahl,
    Name, Englischer Name (only if some card has a different one), Sammlung, Typ, Attribut, Monsterart, Stufe/Rang, ATK, DEF,
    Passcode, Notiz (only if some card has one). Numbers are numbers (so Excel sorts them), a stat printed "?" is the text `?`, the
    passcode is text with its eight digits (Excel would drop a leading zero). Text is written as inline strings, so a name that
    starts with `=` is never a formula. Printed: A4 landscape, as wide as the page, the header row on every page.
  * **Word:** a title, a line with the number of cards and the date, then one heading and one table per collection (A4 landscape,
    the header row repeats on every page, a row does not split across pages). The English name stands small and grey under the name.
  * **Text:** `3x Dark Magician`, one card per line, under a `# Binder A · 4 Karten` comment line per collection. The parser of
    quick entry skips lines that start with `#`, so the list can be pasted into "Schnellerfassung" again (a test does this).
    Windows line breaks, UTF-8.
* File names: `inventar-<scope>-<yyyy-mm-dd>.<ext>` (`inventory-…` in English), the scope being "Alle Karten" or the collection's name.
* Characters XML forbids (control characters in a note) are removed, the others escaped; Excel's sheet-name rules are kept.

## Consequences

* The export is checked three ways: unit tests of the three encoders (the `.xlsx` is read back with the app's own
  `readXlsx`/`rowsToEntryLines`, the text with `parseEntryText`), the query (`tests/nuxt/inventory-export-api.test.ts`) and the
  menu (`tests/nuxt/inventory-export-menu.test.ts`); and a sample of each format was opened in Microsoft Excel and Word and in
  LibreOffice.
* The inventory has no sets, languages or conditions per copy ([ADR 0017](0017-inventory-without-collector-details.md)), so the file has none either.
* The shared and the public views of an inventory have no export: the file is the owner's own.
