// The artwork part of the request body of `POST /api/cards/match-fragments` (ADR 0041): the cards
// the browser recognized by their artwork, checked and cut to size (it is user input).
import type { ArtCard } from '../../shared/card-art'

/** A photo has dozens of cards at most. */
export const MAX_ART_CARDS = 120

/** The recognized cards in the request, or null when the body is not what the endpoint takes. */
export function parseArtCards(raw: unknown): ArtCard[] | null {
  if (!Array.isArray(raw) || raw.length > MAX_ART_CARDS) {
    return null
  }
  const cards: ArtCard[] = []
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) {
      return null
    }
    const { cardId, similarity, margin, copies, support, sure } = entry as Record<string, unknown>
    if (
      typeof cardId !== 'number' || !Number.isInteger(cardId) || cardId <= 0
      || typeof similarity !== 'number' || !Number.isFinite(similarity) || similarity < 0 || similarity > 1.01
      || typeof margin !== 'number' || !Number.isFinite(margin) || margin < 0 || margin > 1.01
      || typeof copies !== 'number' || !Number.isInteger(copies) || copies < 1 || copies > 99
      || typeof support !== 'number' || !Number.isInteger(support) || support < 1 || support > 9999
      || typeof sure !== 'boolean'
    ) {
      return null
    }
    cards.push({ cardId, similarity, margin, copies, support, sure })
  }
  return cards
}
