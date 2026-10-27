// What the card-photo endpoint answers and how sure the page calls a card
// (ADR 0040). Shared so the server's thresholds and the page agree.

/** The page calls a card sure from this similarity of what was read to its name. */
export const SURE_SCORE = 0.85

/** How a card was found on a photo: its printed name was read, its artwork was recognized, or both agree. */
export type PhotoCardSource = 'text' | 'art' | 'both'

/** One card found in the text and the artwork of photos (`POST /api/cards/match-fragments`). */
export interface PhotoCardMatch {
  cardId: number
  /** The English catalog name (canonical). */
  name: string
  /** The text that was read where the card was found (the catalog name when only the artwork was recognized). */
  text: string
  score: number
  /** Copies seen. */
  count: number
  source: PhotoCardSource
}
