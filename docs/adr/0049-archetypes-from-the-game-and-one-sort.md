# 0049: Deckthemen from the game's data, one sort for every card list, the card window (round 16)

## Status

Accepted. Replaces the hand-made list of extra members and German names of the addendum of [ADR 0047](0047-card-kind-filter-leaving-out-and-own-inventory.md).

## Context

Tester feedback, round 16 ("Im inventar kannst du auch die sets anzeigen.docx"): "Die Deckthemen passen immer noch nicht"
(after rounds 14 and 15), one sort ("Erscheinungsdatum, Angriff, Defensive, Stufe, Name A-Z, Kartentyp, Pendelbereich", a small
switch for up and down, "einheitlich") instead of the several that the lists had, a filter that can be reset on its own, the
sets in the inventory's card window with a bigger card text and a smaller set field, and the count of the inventory at another
place.

## Decision

### Deckthemen: the game's data, not the catalog's one tag

* The catalog (YGOPRODeck) has one archetype per card; the game has several, and a card need not carry the archetype's name
  ("Magna Warrior": four cards, two of them filed under "Magnet Warrior"; "Plasma Warrior Eitom" does not have the name).
  The earlier fixes were hand lists for one family. The data now comes from Yugipedia, a semantic wiki: for every card the
  property `Archseries` (the name-derived members included) and for every archetype its `German name`.
* `scripts/archetypes/build.ts` fetches it (about 100 requests, one after another with a pause; the wiki's result size is
  capped, so the cards are asked for by the first letter of their page name) and writes
  `server/data/archetype-members.json` (the run of 16 November 2026: 868 archetypes, 9,539 cards, by passcode) and
  `shared/data/archetype-names-de.json` (763 German names). The wiki's disambiguation ("Dark Magician (archetype)") is removed, the archetypes of the anime only are
  left out, an archetype that came out twice is one. Rerun it to refresh; Yugipedia's text is CC BY-SA 3.0, what is taken is
  facts (which card is in which archetype, the official German name), and the README names the source.
* `server/utils/archetype-data.ts`: a card that is in the data takes its archetypes from it; a card that is not (newer than the
  data, or without an archetype on the wiki) keeps the catalog's archetype. `archetypeClause()` (catalog, inventory list and
  gallery) is `id in (members) or (catalog archetype in names and id not in covered)`, the id lists as one JSON parameter each;
  the menus of the catalog and of the inventory list the archetypes the same way.
* The German names are the official ones (94 of the 110 names of the earlier hand list were the same; the others followed the
  card names, the wiki's are the archetype's own: "Blauäugig", "Grabwächter"). Two archetypes with one German name, such as
  "Magna Warrior" and "Magnet Warrior" (both "Magnetkrieger", also in French, Italian and Portuguese), are one entry of the menu
  in German that filters by both English names; the value in the URL and the API stays the English name.
* Not done: a refresh at run time (the data is a file in the repository), and the format rules still read the catalog's single
  archetype (`catalog_card.archetype`), not the game's.

### One sort

* `shared/card-sort.ts`: a field (`release`, `atk`, `def`, `level`, `name`, `type`, `scale`) and a direction; in the URL and the
  API "atk" is ascending and "-atk" descending, the old `newest` reads as `-release`. A list may add fields of its own with a
  direction too: the inventory list's `updated` (default `-updated`, the latest change first) and the gallery's `quantity`.
  The deck editor adds the choice "Standard" (the usual order) and still stores its choice in the browser (an old `newest` is
  `-release` now); the deck rows carry the pendulum scale for it.
* The server's ORDER BY (`server/utils/card-sort-sql.ts`): a card without the value (a Spell has no ATK, an OCG-only card no
  TCG date, a Link monster no level, a stat printed "?" is stored -1) is last whichever way it goes; ties by name in the card
  language, then by id, so a page never changes its order between two requests. "Kartentyp" is the order of the game's own
  kinds (`CARD_KINDS`: Normal, Effekt, Ritual, Fusion ... Pendel ... Zauber, Falle), `cardKindRank` in SQL and `cardTypeRank` in
  the browser.
* `CardSortControl`: the menu for the field and a small button that flips the direction (another field keeps the direction).
  It is in the catalog's toolbar, in the toolbar above the inventory's cards (list and gallery) and in the deck editor's action
  line, at the right end next to the format.

### Resetting a filter on its own

Every menu of the card filters (Kartenart, Ohne Kartenart, Typ, Attribut, Monsterart, Stufe/Rang, Deckthema, Set) has the small
cross of the menu (`clear`) that empties just that filter; the cross hands over nothing, which every model reads as an empty
list. The format has its own entry "Alle Formate".

### The inventory page and the card window

* The inventory's toolbar sits above the cards: the number of cards the view lists at the left, at the right "Auswählen", the
  view (Liste / Galerie) and the sort (it was in two places at the top).
* The card window shows the sets (the printings) in the inventory too, in a small box of its own (a fixed height, it scrolls); the
  card text got the room and a bigger type. The dates and the English name stay a catalog thing.

## Consequences

* The same archetype can have more cards than the catalog's tag says; a link with an English archetype name keeps working.
* A refresh of the data is a deliberate step (`node scripts/archetypes/build.ts`, review the diff, commit).
* An older bookmark `?sort=newest` and a stored deck sort `newest` still work.
