// One way to sort cards everywhere (tester feedback, round 16: "einheitlich ... daneben ein kleiner Schalter, von auf und
// absteigend"): a field and a direction, in the catalog, the inventory (list and gallery) and the deck editor. Pure, no Vue,
// no Drizzle: the server turns it into ORDER BY (`server/utils/card-sort-sql.ts`), the deck editor sorts its rows with
// `compareCardsBy`.
import { compareCardNames } from './card-text'
import { CARD_KINDS, cardKinds } from './card-kind'
import type { AppLocale } from './locale'

/** What cards can be sorted by: release date, ATK, DEF, level, name, card type, pendulum scale. */
export const CARD_SORT_FIELDS = ['release', 'atk', 'def', 'level', 'name', 'type', 'scale'] as const
export type CardSortField = typeof CARD_SORT_FIELDS[number]

export type SortDirection = 'asc' | 'desc'

export interface SortChoice<Field extends string = CardSortField> {
  field: Field
  direction: SortDirection
}

// The values of the URL and the API: "atk" is ascending, "-atk" descending. Older links said "newest" (now "-release").
const LEGACY: Readonly<Record<string, string>> = { newest: '-release', oldest: 'release' }

/**
 * Reads a sort value of the URL / API: a field of `fields`, with a leading "-" for descending. Anything else is `undefined`, so
 * the caller takes its default.
 */
export function parseSortValue<Field extends string>(raw: unknown, fields: readonly Field[]): SortChoice<Field> | undefined {
  const text = (Array.isArray(raw) ? raw[0] : raw)
  if (typeof text !== 'string') {
    return undefined
  }
  const value = LEGACY[text.trim()] ?? text.trim()
  const direction: SortDirection = value.startsWith('-') ? 'desc' : 'asc'
  const field = (direction === 'desc' ? value.slice(1) : value) as Field
  return fields.includes(field) ? { field, direction } : undefined
}

/** The URL / API value of a choice; the inverse of `parseSortValue`. */
export function sortValueOf(choice: SortChoice<string>): string {
  return `${choice.direction === 'desc' ? '-' : ''}${choice.field}`
}

export function flipDirection(direction: SortDirection): SortDirection {
  return direction === 'asc' ? 'desc' : 'asc'
}

/** Everything a card is sorted by, as far as the lists carry it. */
export interface SortableCard {
  name: string
  nameDe?: string | null
  type?: string | null
  frameType?: string | null
  level?: number | null
  atk?: number | null
  def?: number | null
  scale?: number | null
  /** `YYYY-MM-DD`; null for a card that came out in the OCG only. */
  tcgDate?: string | null
}

/** The place of a card's kind in the game's own order (Normal, Effekt, Ritual ... Zauber, Falle); a card without a kind comes last. */
export function cardTypeRank(card: Pick<SortableCard, 'type' | 'frameType'>): number {
  const kind = cardKinds(card)[0]
  return kind ? CARD_KINDS.indexOf(kind) : CARD_KINDS.length
}

/** A stat the game prints as "?" is stored as -1: it has no value to sort by, like a Spell's. */
function numberOf(value: number | null | undefined): number | null {
  return typeof value === 'number' && value >= 0 ? value : null
}

function compareNumbers(a: number | null, b: number | null, direction: SortDirection): number {
  if (a === b) {
    return 0
  }
  // A card without the value is last, whichever way it goes.
  if (a === null) {
    return 1
  }
  if (b === null) {
    return -1
  }
  return (a < b ? -1 : 1) * (direction === 'desc' ? -1 : 1)
}

/**
 * How two cards compare by the field of `choice` alone: 0 when they are level (the same value, or both without one). Cards
 * without the value come last whichever way it goes. By name the card language decides (ADR 0015).
 */
export function compareCardsByField(choice: SortChoice, a: SortableCard, b: SortableCard, cardLocale: AppLocale): number {
  const { field, direction } = choice
  switch (field) {
    case 'name': {
      const byName = compareCardNames(a, b, cardLocale)
      return direction === 'desc' ? -byName : byName
    }
    case 'release':
      return compareNumbers(a.tcgDate ? Date.parse(a.tcgDate) : null, b.tcgDate ? Date.parse(b.tcgDate) : null, direction)
    case 'atk':
      return compareNumbers(numberOf(a.atk), numberOf(b.atk), direction)
    case 'def':
      return compareNumbers(numberOf(a.def), numberOf(b.def), direction)
    case 'level':
      return compareNumbers(numberOf(a.level), numberOf(b.level), direction)
    case 'scale':
      return compareNumbers(numberOf(a.scale), numberOf(b.scale), direction)
    case 'type':
      return (cardTypeRank(a) - cardTypeRank(b)) * (direction === 'desc' ? -1 : 1)
  }
}

/**
 * The order of two cards under `choice`, for the lists sorted in the browser. The same order the server's ORDER BY gives: cards
 * without the value last, ties by name.
 */
export function compareCardsBy(choice: SortChoice, a: SortableCard, b: SortableCard, cardLocale: AppLocale): number {
  return compareCardsByField(choice, a, b, cardLocale) || compareCardNames(a, b, cardLocale)
}