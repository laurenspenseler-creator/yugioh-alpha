# 0047: The kinds divide the cards; leaving kinds out; only my inventory

## Status

Accepted. Changes the "Kartenart" filter described in `shared/card-kind.ts` (tester feedback, rounds 2 and 12).

## Context

The "Kartenart" filter (catalog, inventory, deck builder) grouped cards by frame, and a Pendulum monster counted twice: a
Pendulum Effect Monster was both "Effekt" and "Pendel". The tester wrote, on the catalog page: "Gib mir die Möglichkeit
Pendel-Monster etc. (alles) auch rauszufiltern. Reicht schon, wenn Effekt-Monster nur Effekt-Monster meint, also dass man
Link, Extra auswählen muss, damit die auch angezeigt werden. Gib mir da auch die Möglichkeit, nur in meinem Inventar zu
suchen."

## Decision

* **The kinds divide the cards.** A Pendulum monster of any frame has the kind "Pendel" and no other: "Effekt" is a plain
  Effect Monster (Flip, Tuner, Spirit, Toon, Union and Gemini included), a Pendulum Effect Monster is only found under
  "Pendel", and so on for Normal, Fusion, Synchro and Xyz. Every card has one kind (a Skill Card none), in `cardKinds()`
  and in its SQL twin `cardKindClause()` (`tests/nuxt/card-kind-filter.test.ts` checks the two against each other for
  every card). The chips of the inventory follow, so the number on a chip is what the list shows after a click, and the
  chips add up to the total. The exact "Typ" filter is unchanged.
* **"Ohne Kartenart"** is a second menu with the same list: the cards must not have any of the kinds picked there
  (`excludeKind=` in the URL, `excludeKinds` in the query; `cardKindExcludeClause()`). A Skill Card, which has no kind, is
  kept. A kind is wanted or unwanted, never both: picking it in one menu takes it out of the other. The catalog has it;
  the inventory and the deck builder do not yet (their chips toggle a kind on or off already).
* **"Nur in meinem Inventar suchen"** is a checkbox of the catalog (`owned=1`): only cards of which the signed-in user has
  at least one copy, in any collection. It combines with every other filter, and a request without a user finds nothing.
* **The inventory chips count different cards, not copies** (the same feedback, first item: 4 Ritual cards three times
  each read "12 Ritual"). Only there: a deck is played with its copies, so the deck's breakdown still counts them.

## Addendum: Zulässigkeit (format) and Deckthema (tester feedback, round 14)

The catalog and the inventory also filter by what a rule format allows, and by the archetype ("Deckthema") of a card.

* **"Zulässigkeit"**: a "Format" menu (any format the user may see: the built-in ones and their own) and, once a format is
  picked, a menu of what to show of it: the cards it allows (`legal`, the default), the ones it does not (`illegal`), or
  the ones at a number of copies (`unlimited` 3, `semi_limited` 2, `limited` 1). It is `formatId=` and `legality=` in the
  URL and the API (`shared/format-legality.ts`; the default is not written to the URL), in the catalog, the inventory's
  list and its gallery. The copy limit of a card comes from the rule engine itself (`maxCopiesByCard`, the same number a
  deck of that format reports), so the filter cannot disagree with the deck editor: it is worked out for the whole
  active catalog once per format, its rules and the catalog version and kept (`server/utils/format-legality.ts`, six
  formats at a time), then the matching ids go to SQL as one JSON parameter (`json_each`), however many they are. A
  format the user may not see (another player's, deleted) filters nothing, and the menu drops it from the URL.
* **"Deckthema"**: the card's archetype (`catalog_card.archetype`, about 700 names, the catalog's own English ones: there
  are no German names for them), picked from a searchable list, several at once and a card needs one of them. The
  catalog's list holds every archetype of an active card, the inventory's the ones of the cards the player owns. Names
  are exact: they go as repeated keys (`archetype=A&archetype=B`) and are never split at a comma, because one has a
  comma in it ("Atlantis, City of the Sea Dragon").
* Where: both are placed by the catalog and the inventory themselves (`CardFormatFilter`, `CardArchetypeFilter`), not
  by the shared facet menus, so the deck builder and the format editor keep their menus.

## Addendum: where the filters sit, German Deckthemen, count and sort (tester feedback, round 15)

The tester's screenshots ("Zieh den blauen Bereich in den roten"):

* **Catalog:** everything that is not the search box moves to one toolbar at the bottom of the filter panel
  (`data-testid="catalog-toolbar"`): the number of cards at the far left, then Deckthema and Format, the two checkboxes
  ("Auch im Kartentext suchen", "Nur in meinem Inventar suchen") and the sort menu at the right edge.
* **Deck editor:** "Sortierung nach Erscheinungsdatum" is in the empty top right of the header (the actions slot), not above
  the sections.
* **Inventory:** a formatted count of the cards shown (as on the catalog page) and an A–Z / Z–A / "zuletzt geändert" sort
  of the list (`sort=name|-name|updated`, `updated` the default; by the card name in the card language). The gallery keeps
  its own order.
* **Detail window of a card:** much larger, and only the card text and the list of printings (the sets it came out in)
  scroll, each in its own area, not the whole window.
* **Deckthema:** every menu has a cross that resets only this filter. The labels follow the card language: German names
  from `shared/archetype-names-de.ts`, at first a hand-checked list of about 100 archetypes taken from the German names of their
  cards; an archetype that is not in it stays in English (the catalog has only English names), and the English name is
  shown as the description and searched too. The value in the URL and the API stays the English name.
* **"Magna Warrior" showed 2 cards: that was wrong, not the filter's fault.** The tester asked whether it is right. First
  answer (mistaken): "it is the data". Checked again against the game's own member lists (Yugipedia, "Magna Warrior" and
  "Magnet Warrior"): the game has **four** Magna Warriors (Valkyrion, Berserkion, Tellusion, Plasma Warrior Eitom) and the
  family is split by YGOPRODeck, which has one archetype per card, over "Magna Warrior" (2 cards), "Magnet Warrior" (8)
  and "Magnet" (9). A card does not have to carry the archetype's name (Plasma Warrior Eitom does not), and the catalog's
  single field cannot say it. Two more facts: in German, French, Italian and Portuguese both archetypes have one name
  ("Magnetkrieger"), so a German player picking it expects both.
  * First fix (commit fd0c412): a hand-checked list of extra members for this family (`shared/archetype-members.ts`),
    added to what the catalog says. "Magna Warrior" then listed 4 cards, "Magnet Warrior" 15, both 17.
  * In the German card language the menu has one entry "Magnetkrieger" for the archetypes that share a German name; picking
    it filters by both English names (URL and API unchanged). This stays.
  * **The hand list is gone ([ADR 0049](0049-archetypes-from-the-game-and-one-sort.md)):** the tester said again that the
    Deckthemen do not fit ("passen immer noch nicht"), and the cause was general (one archetype per card in the source).
    The membership of every card and the German names of the archetypes now come from Yugipedia's data.
* **Not built: card pictures in German.** The catalog has one picture per card (the English one). There is no source of
  German scans that the app may fetch without a licence of its own, so the card language changes names and texts, not the
  picture.

## Consequences

* A Pendulum monster no longer turns up when "Effekt", "Xyz" or "Normal" alone is picked; pick "Pendel" as well, or use the
  exact type.
* `loadInventoryKindCounts` counts `count(distinct catalog_card_id)` per kind and scope; a card in two collections counts
  once in the whole inventory and once in each collection.
* Not built: "Ohne Kartenart" in the inventory and the deck builder.
