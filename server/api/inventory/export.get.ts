import { getQuery } from 'h3'
import { useDb } from '../../db'
import { requireCollectionOwnedByUser } from '../../utils/collections'
import { exportOwnedCards, parseInventoryListQuery } from '../../utils/inventory'
import { requireUser } from '../../utils/session'
import { resolveCardLocale } from '../../utils/ui-locale'
import { UNASSIGNED_COLLECTION_ID } from '../../../shared/inventory'

/**
 * The rows of the inventory export (ADR 0051): every copy the list view shows for the same search, facets and collection, not one
 * page of it. The query is the one of `GET /api/inventory` (`page`, `pageSize` and `sort` are ignored); the browser builds the
 * Excel, Word or text file from the rows.
 */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const options = parseInventoryListQuery(getQuery(event))
  const db = useDb()

  if (options.collectionId && options.collectionId !== UNASSIGNED_COLLECTION_ID) {
    requireCollectionOwnedByUser(db, user.id, options.collectionId)
  }

  return exportOwnedCards(db, user.id, { ...options, cardLocale: await resolveCardLocale(event) })
})
