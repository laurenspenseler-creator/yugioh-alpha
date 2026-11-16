import { and, inArray, or, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { catalogCard } from '../db/schema'
import { archetypeData } from './archetype-data'

/**
 * The "Deckthema" condition: a card is in when the game counts it in one of the archetypes (`archetype-data.ts`: a card can be in
 * several, and need not carry the name), or, for a card the data does not have, when the catalog files it under one of them.
 * One of the names is enough. The outer query must use `catalog_card` unaliased. The id lists go as one JSON parameter each,
 * however long they are.
 */
export function archetypeClause(names: readonly string[]): SQL {
  const data = archetypeData()
  const members = data.memberIds(names)
  const byData = members.length > 0
    ? sql`${catalogCard.id} in (select value from json_each(${JSON.stringify(members)}))`
    : sql`0`
  const byCatalog = and(
    inArray(catalogCard.archetype, [...names]),
    sql`${catalogCard.id} not in (select value from json_each(${data.coveredIdsJson}))`,
  )
  return or(byData, byCatalog) as SQL
}
