import { inArray, or } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { catalogCard } from '../db/schema'
import { extraMemberIds } from '../../shared/archetype-members'

/**
 * The "Deckthema" condition: a card is in when the catalog files it under one of the archetypes, or when the game counts
 * it in one of them although the catalog does not (`shared/archetype-members.ts`). One of the names is enough.
 */
export function archetypeClause(names: readonly string[]): SQL {
  const byName = inArray(catalogCard.archetype, [...names])
  const extra = extraMemberIds(names)
  return (extra.length > 0 ? or(byName, inArray(catalogCard.id, extra)) : byName) as SQL
}
