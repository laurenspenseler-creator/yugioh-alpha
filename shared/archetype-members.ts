// Cards the game counts in a Deckthema (archetype) although the catalog files them under another one.
//
// The catalog comes from YGOPRODeck, which has ONE archetype per card; the game has more: "Magna Warrior" and "Magnet Warrior"
// are two archetypes of one family (Yugipedia: "separate but related"), and YGOPRODeck splits that family over "Magna Warrior"
// (2 cards), "Magnet Warrior" (8) and "Magnet" (9). A player who picks "Magna Warrior" expects all four Magna Warriors, one who
// picks "Magnet Warrior" all the Magnet Warrior monsters (tester feedback, round 15: "Magna Warrior" showed 2 cards).
//
// These are ADDED to what the catalog says, never taken away: a card stays under the archetype of the source and also shows up
// under these. Source: the member lists of the pages "Magna Warrior" and "Magnet Warrior" on yugipedia.com, read 2026-11-14.
// Only cards that exist in the catalog are listed; the ids are the passcodes.

export const ARCHETYPE_EXTRA_MEMBERS: Readonly<Record<string, readonly number[]>> = {
  // Valkyrion the Magna Warrior, Berserkion the Electromagna Warrior (the catalog has Tellusion the Magna Warrior and
  // Plasma Warrior Eitom under "Magna Warrior" already).
  'Magna Warrior': [75347539, 42901635],
  // Alpha, Beta and Gamma The Electromagnet Warrior, Delta The Magnet Warrior, Magnet Warrior Sigma Plus / Sigma Minus and
  // Omega Plus (all filed under "Magnet" by the catalog).
  'Magnet Warrior': [42023223, 79418928, 15502037, 12262393, 51826619, 87814728, 86289475],
}

/** The ids of the cards that the given archetypes add to what the catalog files under their names. */
export function extraMemberIds(names: readonly string[]): number[] {
  const ids = new Set<number>()
  for (const name of names) {
    for (const id of ARCHETYPE_EXTRA_MEMBERS[name] ?? []) {
      ids.add(id)
    }
  }
  return [...ids]
}

/** The archetypes this card is added to, besides the one the catalog files it under. */
export function extraArchetypesOf(cardId: number): string[] {
  return Object.entries(ARCHETYPE_EXTRA_MEMBERS)
    .filter(([, ids]) => ids.includes(cardId))
    .map(([name]) => name)
}
