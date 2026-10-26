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
   * Copies per card kind in the chip order (Normal, Effekt, Ritual, Zauber,
   * Falle, Fusion, Synchro, Xyz, Pendel, Link); kinds without copies are left
   * out. A Pendulum monster counts under its frame and under Pendel.
   */
  kinds: Array<{ kind: InventoryKind, count: number }>
  /** All copies in the scope (every copy once, so Pendel is not added). */
  total: number
}

/**
 * How many copies of each card kind the user owns, as the chips next to the
 * inventory's filters show them. `collectionId` scopes it like the page does:
 * a collection id, `UNASSIGNED_COLLECTION_ID` for copies in no collection, or
 * nothing for the whole inventory. A collection that isn't the user's has no
 * copies of theirs, so it counts as empty.
 *
 * Grouped by (type, frame type) in SQL and sorted into kinds in code, with
 * the same rules as the deck breakdown and the "Kartenart" filter.
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
      copies: sql<number>`coalesce(sum(${ownedCard.quantity}), 0)`,
    })
    .from(ownedCard)
    .innerJoin(catalogCard, eq(catalogCard.id, ownedCard.catalogCardId))
    .where(and(eq(ownedCard.userId, userId), scope))
    .groupBy(catalogCard.type, catalogCard.frameType)
    .all()

  const kinds = inventoryKindBreakdown(rows.map(row => ({ type: row.type, frameType: row.frameType, quantity: Number(row.copies) })))
  return { kinds, total: kinds.reduce((sum, entry) => (entry.kind === 'pendulum' ? sum : sum + entry.count), 0) }
}
