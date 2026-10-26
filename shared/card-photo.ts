// What the card-photo endpoint answers and how sure the page calls a card
// (ADR 0040). Shared so the server's thresholds and the page agree.

/** The page calls a card sure from this similarity of what was read to its name. */
export const SURE_SCORE = 0.85

/** One card found in the text of photos (`POST /api/cards/match-fragments`). */
export interface PhotoCardMatch {
  cardId: number
  /** The English catalog name (canonical). */
  name: string
  /** The text that was read where the card was found. */
  text: string
  score: number
  /** Copies seen. */
  count: number
}
