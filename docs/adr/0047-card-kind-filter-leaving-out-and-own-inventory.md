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

## Consequences

* A Pendulum monster no longer turns up when "Effekt", "Xyz" or "Normal" alone is picked; pick "Pendel" as well, or use the
  exact type.
* `loadInventoryKindCounts` counts `count(distinct catalog_card_id)` per kind and scope; a card in two collections counts
  once in the whole inventory and once in each collection.
* Not built: "Ohne Kartenart" in the inventory and the deck builder.
