import { asc, desc, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core'
import { catalogCard } from '../db/schema'
import { cardKindRank } from './card-kind-sql'
import { cardSortKey } from './card-translation-sql'
import { CARD_SORT_FIELDS, parseSortValue } from '../../shared/card-sort'
import type { SortChoice } from '../../shared/card-sort'
import type { AppLocale } from '../../shared/locale'

/** The sort the catalog, the gallery and the list start with: by name, A to Z. */
export const DEFAULT_CARD_SORT_VALUE = 'name'

/** Fields beyond the card's own that one list also offers: its own columns, e.g. `updated` or `quantity`. */
export type ExtraSortFields = Readonly<Record<string, SQL>>

/**
 * The sort value of a request (`name`, `-atk`, ...; the old `newest` too) or `fallback`. `extra` names the fields this list has on
 * top of the card's ones.
 */
export function readSortValue(raw: unknown, fallback: string = DEFAULT_CARD_SORT_VALUE, extra: readonly string[] = []): string {
  const choice = parseSortValue(raw, [...CARD_SORT_FIELDS, ...extra])
  return choice ? `${choice.direction === 'desc' ? '-' : ''}${choice.field}` : fallback
}

// A stat printed "?" is stored as -1 and has no value to sort by.
const stat = (column: SQL | AnySQLiteColumn) => sql`(case when ${column} < 0 then null else ${column} end)`

/**
 * The ORDER BY of a sort value for lists of catalog cards. Cards without the value (a Spell has no ATK, an OCG-only card no TCG
 * date) come last whichever way it goes; ties are by name (in the card language, ADR 0015), then by id. `extra` adds fields of the
 * list's own (the inventory's `updated`, the gallery's `quantity`); `after` goes behind the ties (the rows of one card).
 */
export function cardSortOrderBy(value: string, cardLocale: AppLocale, extra: ExtraSortFields = {}, after: SQL[] = []): SQL[] {
  const choice: SortChoice<string> = parseSortValue(value, [...CARD_SORT_FIELDS, ...Object.keys(extra)])
    ?? { field: DEFAULT_CARD_SORT_VALUE, direction: 'asc' }
  const dir = choice.direction === 'desc' ? desc : asc
  const nameKey = cardSortKey(cardLocale)
  const nullsLast = (expression: SQL): SQL[] => [sql`${expression} is null`, dir(expression)]

  let primary: SQL[]
  switch (choice.field) {
    case 'name':
      return [dir(nameKey), asc(catalogCard.id), ...after]
    case 'release':
      primary = nullsLast(sql`${catalogCard.tcgDate}`)
      break
    case 'atk':
      primary = nullsLast(stat(catalogCard.atk))
      break
    case 'def':
      primary = nullsLast(stat(catalogCard.def))
      break
    case 'level':
      primary = nullsLast(stat(catalogCard.level))
      break
    case 'scale':
      primary = nullsLast(stat(catalogCard.scale))
      break
    case 'type':
      primary = [dir(cardKindRank)]
      break
    default:
      // A field of the list's own.
      primary = [dir(extra[choice.field]!)]
  }
  return [...primary, asc(nameKey), asc(catalogCard.id), ...after]
}
