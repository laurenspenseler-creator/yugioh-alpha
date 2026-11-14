// The "Zulässigkeit" filter on the server (tester feedback, round 14): the ids of the catalog cards a rule format allows,
// or does not, in a given number of copies. The limit of every card comes from the rule engine itself
// (`maxCopiesByCard`), so the filter can never disagree with what a deck of that format later reports.
//
// Working out the limit of the whole catalog (about 15,000 cards) takes a moment, so it is kept per format, its rules and
// the catalog version; a format edit, a catalog sync or a restart (a new banlist in the code) makes a new one.

import { createHash } from 'node:crypto'
import { count, max, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { useDb } from '../db'
import { catalogCard } from '../db/schema'
import { activeCatalogCard } from './card-name-search'
import { maxCopiesByCard } from './deck-validation'
import { requireAccessibleFormat } from './rule-formats'
import { DEFAULT_FORMAT_LEGALITY, isFormatLegality, legalityMatches } from '../../shared/format-legality'
import type { FormatLegality } from '../../shared/format-legality'

type Db = ReturnType<typeof useDb>

/** Cards per call of the rule engine: the card data of a chunk is read with one `IN (...)`. */
const CHUNK_SIZE = 800
/** Formats kept at once; a player picks one or two. */
const MAX_CACHED_FORMATS = 6

const limitCache = new Map<string, Map<number, number>>()

/** What the client asked for: a format, and what to show of it (the cards one may play, by default). */
export interface FormatLegalityQuery {
  formatId?: string
  legality?: FormatLegality
}

function firstString(raw: unknown): string | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

/** `formatId` and `legality` from a query string; without a format there is nothing to filter, and a wrong `legality` is the default. */
export function parseFormatLegalityQuery(rawFormatId: unknown, rawLegality: unknown): FormatLegalityQuery {
  const formatId = firstString(rawFormatId)
  if (!formatId) {
    return {}
  }
  const legality = firstString(rawLegality)
  return { formatId, legality: isFormatLegality(legality) ? legality : DEFAULT_FORMAT_LEGALITY }
}

/** Forgets the limits worked out so far (a test, or after the catalog changed under it). */
export function clearFormatLegalityCache(): void {
  limitCache.clear()
}

function catalogVersion(db: Db): string {
  const row = db.select({ cards: count(), syncedAt: max(catalogCard.syncedAt) }).from(catalogCard).get()
  return `${row?.cards ?? 0}:${row?.syncedAt?.getTime() ?? 0}`
}

/**
 * The copy limit (0 to 3) of every active catalog card under the format, or `null` when the format is not one the user may
 * see (another player's, or gone): then there is nothing to filter by.
 */
export function formatCardLimits(db: Db, userId: string, formatId: string): Map<number, number> | null {
  let format
  try {
    format = requireAccessibleFormat(db, userId, formatId)
  }
  catch {
    return null
  }

  // The rules themselves are part of the key (not the edit time): an edit within the same millisecond still gets new limits.
  const rulesHash = createHash('sha1').update(JSON.stringify(format.rules ?? null)).digest('hex')
  const key = `${format.id}:${rulesHash}:${catalogVersion(db)}`
  const cached = limitCache.get(key)
  if (cached) {
    return cached
  }

  const ids = db.select({ id: catalogCard.id }).from(catalogCard).where(activeCatalogCard()).all().map(row => row.id)
  const limits = new Map<number, number>()
  for (let start = 0; start < ids.length; start += CHUNK_SIZE) {
    for (const [id, copies] of maxCopiesByCard(db, format.rules ?? null, ids.slice(start, start + CHUNK_SIZE))) {
      limits.set(id, copies)
    }
  }

  // The newest few stay; the map keeps insertion order.
  for (const oldest of [...limitCache.keys()].slice(0, Math.max(0, limitCache.size - MAX_CACHED_FORMATS + 1))) {
    limitCache.delete(oldest)
  }
  limitCache.set(key, limits)
  return limits
}

/**
 * The ids of the active catalog cards that pass the filter, or `null` when there is no format to filter by (none asked
 * for, or one the user may not see).
 */
export function legalityCardIds(db: Db, userId: string, query: FormatLegalityQuery): number[] | null {
  if (!query.formatId) {
    return null
  }
  const limits = formatCardLimits(db, userId, query.formatId)
  if (!limits) {
    return null
  }
  const legality = query.legality ?? DEFAULT_FORMAT_LEGALITY
  const ids: number[] = []
  for (const [id, copies] of limits) {
    if (legalityMatches(legality, copies)) {
      ids.push(id)
    }
  }
  return ids
}

/** The WHERE clause for a list of card ids from `legalityCardIds`; the outer query must use `catalog_card` unaliased. One parameter, however many ids. */
export function legalityClause(ids: readonly number[]): SQL {
  return sql`${catalogCard.id} in (select value from json_each(${JSON.stringify(ids)}))`
}
