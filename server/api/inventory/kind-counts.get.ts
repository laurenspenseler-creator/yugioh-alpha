import { getQuery } from 'h3'
import { useDb } from '../../db'
import { loadInventoryKindCounts } from '../../utils/inventory-kind-counts'
import { requireUser } from '../../utils/session'

/**
 * `GET /api/inventory/kind-counts?collectionId=` → `{ kinds: [{ kind, count }], total }`:
 * the different cards per card kind (Monster kinds, Zauber, Falle …; a card owned
 * three times counts once) of the whole inventory, of one collection, or of the
 * copies without a collection.
 */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const collectionId = getQuery(event).collectionId
  return loadInventoryKindCounts(useDb(), user.id, typeof collectionId === 'string' && collectionId !== '' ? collectionId : undefined)
})
