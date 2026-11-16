import membersJson from '../data/archetype-members.json'

// Which card is in which Deckthema (archetype), as the game has it (tester feedback, round 16: "Die Deckthemen passen immer noch
// nicht"). The catalog (YGOPRODeck) has one archetype per card; the game has several, and a card need not carry the archetype's
// name. `server/data/archetype-members.json` is built from Yugipedia by `scripts/archetypes/build.ts` (ADR 0049): for every
// archetype the passcodes of its cards.
//
// A card that is in this data takes its archetypes from it; one that is not (a card newer than the data, or one without an
// archetype on the wiki) keeps the archetype of the catalog (`catalog_card.archetype`). So nothing the catalog knows is lost, and
// the data corrects the cards it has.

/** `{ "<archetype>": [passcode, ...] }` */
export type ArchetypeMembers = Readonly<Record<string, readonly number[]>>

export interface ArchetypeData {
  /** The archetypes by name, sorted. */
  names: string[]
  /** The cards of the given archetypes, each once. */
  memberIds: (names: readonly string[]) => number[]
  /** The archetypes of one card (empty for a card the data does not have). */
  archetypesOf: (cardId: number) => string[]
  /** Every card the data has an archetype for. */
  coveredIds: ReadonlySet<number>
  /** `coveredIds` as a JSON array, ready to be one SQL parameter. */
  coveredIdsJson: string
}

export function buildArchetypeData(members: ArchetypeMembers): ArchetypeData {
  const byCard = new Map<number, string[]>()
  for (const [name, ids] of Object.entries(members)) {
    for (const id of ids) {
      byCard.set(id, [...(byCard.get(id) ?? []), name])
    }
  }
  return {
    names: Object.keys(members).sort(),
    memberIds: names => [...new Set(names.flatMap(name => members[name] ?? []))],
    archetypesOf: cardId => byCard.get(cardId) ?? [],
    coveredIds: new Set(byCard.keys()),
    coveredIdsJson: JSON.stringify([...byCard.keys()]),
  }
}

let current: ArchetypeData | undefined

/** The data of the app (built once from the file). */
export function archetypeData(): ArchetypeData {
  current ??= buildArchetypeData(membersJson as unknown as ArchetypeMembers)
  return current
}

/** For tests: use this data instead of the file's; `undefined` goes back to the file's. */
export function useArchetypeDataForTests(members: ArchetypeMembers | undefined): void {
  current = members ? buildArchetypeData(members) : undefined
}

/**
 * The archetypes of a card for a menu: the data's when it has the card, else the catalog's. `catalogArchetype` is the card's
 * `catalog_card.archetype`.
 */
export function archetypesForMenu(data: ArchetypeData, cardId: number, catalogArchetype: string | null | undefined): string[] {
  if (data.coveredIds.has(cardId)) {
    return data.archetypesOf(cardId)
  }
  return catalogArchetype ? [catalogArchetype] : []
}
