// The order of the rows in a deck section, shared by the server (which sorts
// every deck response) and the deck editor (which slots an optimistic row in
// before the answer arrives, #148). Pure, no Vue, no Drizzle.
import { compareCardNames } from './card-text'
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
 * How the deck editor lists the cards of a section (tester feedback, round 13): the conventional order above, or by the
 * date the card first came out in the TCG, newest or oldest first.
 */
export type DeckSort = 'default' | 'newest' | 'oldest'

export const DECK_SORTS = ['default', 'newest', 'oldest'] as const

export function isDeckSort(value: unknown): value is DeckSort {
  return typeof value === 'string' && (DECK_SORTS as readonly string[]).includes(value)
}

export interface DeckDatedRow extends DeckOrderRow {
  /** `YYYY-MM-DD`, or null when the card has no TCG release date (an OCG-only card). */
  tcgDate?: string | null
}

/**
 * The order of two rows of a section under `sort`. By date, a card without one comes last whichever way it goes, and
 * cards of the same day (a whole set comes out at once) keep the conventional order among themselves.
 */
export function compareDeckRowsBy(sort: DeckSort, section: DeckSection, a: DeckDatedRow, b: DeckDatedRow, cardLocale: AppLocale): number {
  if (sort === 'default') {
    return compareDeckRows(section, a, b, cardLocale)
  }
  const dateA = a.tcgDate || null
  const dateB = b.tcgDate || null
  if (dateA !== dateB) {
    if (dateA === null) {
      return 1
    }
    if (dateB === null) {
      return -1
    }
    // ISO dates compare as text.
    return (dateA < dateB ? -1 : 1) * (sort === 'newest' ? -1 : 1)
  }
  return compareDeckRows(section, a, b, cardLocale)
}
