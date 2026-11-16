// The order of the rows in a deck section, shared by the server (which sorts
// every deck response) and the deck editor (which slots an optimistic row in
// before the answer arrives, #148). Pure, no Vue, no Drizzle.
import { compareCardNames } from './card-text'
import { CARD_SORT_FIELDS, compareCardsByField, parseSortValue, sortValueOf } from './card-sort'
import type { SortableCard } from './card-sort'
import type { AppLocale } from './locale'
import type { DeckSection } from './deck-sections'

/** Monsters first (0), then spells (1), then traps (2). */
export function cardCategoryRank(type: string): number {
  if (type.toLowerCase().includes('spell')) {
    return 1
  }
  if (type.toLowerCase().includes('trap')) {
    return 2
  }
  return 0
}

export interface DeckOrderRow {
  type: string
  name: string
  nameDe?: string | null
}

/**
 * The conventional deck-list order: the Main Deck by monsters / spells /
 * traps, then by name; Extra and Side by name. Names are compared in the
 * card language (ADR 0015).
 */
export function compareDeckRows(section: DeckSection, a: DeckOrderRow, b: DeckOrderRow, cardLocale: AppLocale): number {
  const byName = compareCardNames(a, b, cardLocale)
  return section === 'main' ? cardCategoryRank(a.type) - cardCategoryRank(b.type) || byName : byName
}

/**
 * How the deck editor lists the cards of a section: the conventional order above (`default`), or by a field and a direction
 * like every card list (shared/card-sort.ts: `release`, `-atk`, `name`, ...; tester feedback, rounds 13 and 16). The first
 * version only knew `newest` and `oldest`: they still read as `-release` and `release`.
 */
export type DeckSort = string

export const DECK_SORT_DEFAULT = 'default'

export function isDeckSort(value: unknown): value is DeckSort {
  return value === DECK_SORT_DEFAULT || parseSortValue(value, CARD_SORT_FIELDS) !== undefined
}

/** The sort in its current spelling (an old `newest` becomes `-release`); anything unknown is the conventional order. */
export function normalizeDeckSort(value: unknown): DeckSort {
  const choice = parseSortValue(value, CARD_SORT_FIELDS)
  return choice ? sortValueOf(choice) : DECK_SORT_DEFAULT
}

export interface DeckDatedRow extends DeckOrderRow, Partial<Omit<SortableCard, 'name' | 'nameDe' | 'type'>> {
  /** `YYYY-MM-DD`, or null when the card has no TCG release date (an OCG-only card). */
  tcgDate?: string | null
}

/**
 * The order of two rows of a section under `sort`. By a field, a card without a value comes last whichever way it goes, and
 * cards that are level (a whole set comes out at once) keep the conventional order among themselves.
 */
export function compareDeckRowsBy(sort: DeckSort, section: DeckSection, a: DeckDatedRow, b: DeckDatedRow, cardLocale: AppLocale): number {
  const choice = parseSortValue(sort, CARD_SORT_FIELDS)
  if (!choice) {
    return compareDeckRows(section, a, b, cardLocale)
  }
  return compareCardsByField(choice, a, b, cardLocale) || compareDeckRows(section, a, b, cardLocale)
}
