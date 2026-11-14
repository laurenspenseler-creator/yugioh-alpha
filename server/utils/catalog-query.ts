import { and, eq, inArray, or, sql, type SQL } from 'drizzle-orm'
import { catalogCard, catalogPrinting, ownedCard } from '../db/schema'
import { archetypeClause } from './archetype-clause'
import { activeCatalogCard, cardNameMatches, cardTextMatches } from './card-name-search'
import { cardKindClause, cardKindExcludeClause, parseCardKinds } from './card-kind-sql'
import { legalityClause, parseFormatLegalityQuery } from './format-legality'
import { parseQueryFlag } from './query-flag'
import type { CardKind } from '../../shared/card-kind'
import type { FormatLegality } from '../../shared/format-legality'

export type CatalogSort = 'name' | '-name' | 'newest'

export interface CardListQuery {
  q: string
  inText: boolean
  // The grouped "Kartenart" filter (shared/card-kind.ts), next to the exact `types`.
  kinds: CardKind[]
  // The kinds the cards must NOT have ("Kartenart ausschließen", tester feedback round 12).
  excludeKinds: CardKind[]
  // Only cards the user owns ("nur mein Inventar"); needs the user's id in `buildCardListWhere`.
  owned: boolean
  // "Zulässigkeit" (tester feedback, round 14): the cards a rule format allows (or not, or in how many copies). The
  // list of matching ids is worked out by `searchCatalog` and given to `buildCardListWhere`.
  formatId?: string
  legality?: FormatLegality
  // "Deckthema" (the archetype of a card, tester feedback, round 14); exact names, one of them is enough.
  archetypes: string[]
  types: string[]
  attributes: string[]
  races: string[]
  levels: number[]
  setId?: string
  sort: CatalogSort
  page: number
  pageSize: number
}

type RawQueryValue = string | number | boolean | null | undefined | Array<string | number | boolean | null | undefined>
export type RawCardListQuery = Record<string, RawQueryValue>

const DEFAULT_PAGE_SIZE = 24
const MAX_PAGE_SIZE = 60
const SORTS = new Set<CatalogSort>(['name', '-name', 'newest'])

function getValues(value: RawQueryValue): string[] {
  const values = Array.isArray(value) ? value : [value]

  return values
    .flatMap(item => String(item ?? '').split(','))
    .map(item => item.trim())
    .filter(Boolean)
}

/**
 * Exact values: repeated keys only, never split at a comma, because an archetype's name can hold one ("Atlantis, City of the
 * Sea Dragon").
 */
function getExactValues(value: RawQueryValue): string[] {
  const values = Array.isArray(value) ? value : [value]
  return [...new Set(values.map(item => String(item ?? '').trim()).filter(Boolean))]
}

function getFirst(value: RawQueryValue): string | undefined {
  return getValues(value)[0]
}

function parsePositiveInt(value: RawQueryValue, fallback: number): number {
  const parsed = Number.parseInt(getFirst(value) ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export function parseCardListQuery(rawQuery: RawCardListQuery): CardListQuery {
  const page = parsePositiveInt(rawQuery.page, 1)
  const requestedPageSize = parsePositiveInt(rawQuery.pageSize, DEFAULT_PAGE_SIZE)
  const sort = getFirst(rawQuery.sort)

  return {
    q: (getFirst(rawQuery.q) ?? '').trim(),
    inText: parseQueryFlag(rawQuery.inText),
    kinds: parseCardKinds(getValues(rawQuery.kind)),
    excludeKinds: parseCardKinds(getValues(rawQuery.excludeKind)),
    owned: parseQueryFlag(rawQuery.owned),
    ...parseFormatLegalityQuery(getFirst(rawQuery.formatId), getFirst(rawQuery.legality)),
    archetypes: getExactValues(rawQuery.archetype),
    types: getValues(rawQuery.type),
    attributes: getValues(rawQuery.attribute),
    races: getValues(rawQuery.race),
    levels: getValues(rawQuery.level)
      .map(value => Number.parseInt(value, 10))
      .filter(Number.isFinite),
    setId: getFirst(rawQuery.setId),
    sort: sort && SORTS.has(sort as CatalogSort) ? sort as CatalogSort : 'name',
    page,
    pageSize: Math.min(requestedPageSize, MAX_PAGE_SIZE),
  }
}

/**
 * The WHERE condition of the catalog list. `userId` is whose inventory "nur mein Inventar" (`filters.owned`) looks at; a
 * list asked for owned cards without a user finds nothing, since nobody owns them. `legalityIds` are the cards that pass
 * the "Zulässigkeit" filter (`legalityCardIds`), when there is one.
 */
export function buildCardListWhere(filters: CardListQuery, userId?: string, legalityIds?: readonly number[] | null): SQL {
  // Catalog-wide: retired cards never show up (ADR 0019).
  const conditions: SQL[] = [activeCatalogCard()]

  if (filters.owned) {
    conditions.push(userId
      ? sql`exists (
        select 1 from ${ownedCard}
        where ${eq(ownedCard.catalogCardId, catalogCard.id)}
          and ${eq(ownedCard.userId, userId)}
      )`
      : sql`0 = 1`)
  }

  if (filters.q) {
    // Bilingual: English and German names (and texts with `inText`), ADR 0015.
    const nameCondition = cardNameMatches(filters.q)
    conditions.push(
      filters.inText
        ? or(nameCondition, cardTextMatches(filters.q))!
        : nameCondition,
    )
  }

  const kindClause = cardKindClause(filters.kinds)
  if (kindClause) {
    conditions.push(kindClause)
  }

  const excludeKindClause = cardKindExcludeClause(filters.excludeKinds)
  if (excludeKindClause) {
    conditions.push(excludeKindClause)
  }

  if (legalityIds) {
    conditions.push(legalityClause(legalityIds))
  }

  if (filters.archetypes.length > 0) {
    conditions.push(archetypeClause(filters.archetypes))
  }

  if (filters.types.length > 0) {
    conditions.push(inArray(catalogCard.type, filters.types))
  }

  if (filters.attributes.length > 0) {
    conditions.push(inArray(catalogCard.attribute, filters.attributes))
  }

  if (filters.races.length > 0) {
    conditions.push(inArray(catalogCard.race, filters.races))
  }

  if (filters.levels.length > 0) {
    conditions.push(inArray(catalogCard.level, filters.levels))
  }

  if (filters.setId) {
    conditions.push(sql`exists (
      select 1 from ${catalogPrinting}
      where ${eq(catalogPrinting.cardId, catalogCard.id)}
        and ${eq(catalogPrinting.setId, filters.setId)}
    )`)
  }

  return and(...conditions)!
}
