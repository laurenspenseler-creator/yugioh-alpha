import { and, eq, isNull, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { useDb } from '../db'
import { catalogCard, ownedCard } from '../db/schema'
import { inventoryKindBreakdown } from '../../shared/deck-breakdown'
import type { InventoryKind } from '../../shared/deck-breakdown'
import { UNASSIGNED_COLLECTION_ID } from '../../shared/inventory'

type Db = ReturnType<typeof useDb>

export interface InventoryKindCounts {
  /**
   * Different cards per card kind in the chip order (Normal, Effekt, Ritual,
   * Zauber, Falle, Fusion, Synchro, Xyz, Pendel, Link); kinds without cards are
   * left out. A card owned three times counts once (tester feedback: 4 Ritual
   * cards x 3 copies read "12 Ritual"). A Pendulum monster counts under Pendel
   * only, not under its frame as well.
   */
  kinds: Array<{ kind: InventoryKind, count: number }>
  /** All different cards in the scope: the chips add up to it. */
  total: number
}

/**
 * How many different cards of each card kind the user owns, as the chips next
 * to the inventory's filters show them. Only here: a deck's breakdown counts
 * copies, because a deck is played with its copies. `collectionId` scopes it
 * like the page does: a collection id, `UNASSIGNED_COLLECTION_ID` for copies in
 * no collection, or nothing for the whole inventory. A collection that isn't
 * the user's has no cards of theirs, so it counts as empty.
 *
 * Grouped by (type, frame type) in SQL and sorted into kinds in code, with
 * the same rules as the deck breakdown and the "Kartenart" filter. A card
 * that is held in several stacks (other collection, other condition) is
 * counted once per scope.
 */
export function loadInventoryKindCounts(db: Db, userId: string, collectionId?: string): InventoryKindCounts {
  const scope: SQL | undefined = collectionId === UNASSIGNED_COLLECTION_ID
    ? isNull(ownedCard.collectionId)
    : collectionId
      ? eq(ownedCard.collectionId, collectionId)
      : undefined

  const rows = db
    .select({
      type: catalogCard.type,
      frameType: catalogCard.frameType,
      cards: sql<number>`count(distinct ${ownedCard.catalogCardId})`,
    })
    .from(ownedCard)
    .innerJoin(catalogCard, eq(catalogCard.id, ownedCard.catalogCardId))
    .where(and(eq(ownedCard.userId, userId), scope))
    .groupBy(catalogCard.type, catalogCard.frameType)
    .all()

  // The breakdown sums a row's `quantity`; here it is the number of different cards of the group, not of copies.
  const kinds = inventoryKindBreakdown(rows.map(row => ({ type: row.type, frameType: row.frameType, quantity: Number(row.cards) })))
  return { kinds, total: kinds.reduce((sum, entry) => sum + entry.count, 0) }
}
