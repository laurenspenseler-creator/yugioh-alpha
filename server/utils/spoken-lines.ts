// Dictated card lines, put together again where the recognizer cut one name in two (ADR 0040).
// A name with a dash or a comma in it ("Schwarz Glänzender Soldat - Gesandter des Anfangs") is
// said with a pause and written as two lines; each half then matches some other card or none.
// Two neighbouring lines are one card when the two together are clearly closer to a card name
// than either is alone.
import type { useDb } from '../db'
import { normalizeCardName, similarity, suggestCatalogMatches } from './card-entry'

type Db = ReturnType<typeof useDb>

/** More lines or longer lines than this are not a dictation. */
export const MAX_SPOKEN_LINES = 80
export const MAX_SPOKEN_LINE_LENGTH = 200

/** Together, the halves must be at least this close to a card name... */
const MIN_JOINED_SIMILARITY = 0.85
/** ...and either this much closer than the better half alone... */
const JOIN_ADVANTAGE = 0.1
/**
 * ...or almost exactly a name while the worse half alone is hardly one: "Schwarz Glänzender Soldat" is a
 * card of its own, so the first half cannot be beaten, but "Gesandter des Anfangs" is no card at all.
 */
const NEARLY_EXACT = 0.9
const FRAGMENT_BELOW = 0.7

const QUANTITY = /^(\d{1,2})x\s+(.+)$/i

/** The similarity of a text to its closest card name (English or German), by letters only. */
function closestNameSimilarity(db: Db, text: string): number {
  const folded = normalizeCardName(text)
  if (folded === '') {
    return 0
  }
  let best = 0
  for (const candidate of suggestCatalogMatches(db, { raw: text, quantity: 1, query: text }, { limit: 5 })) {
    for (const name of [candidate.name, candidate.nameDe]) {
      if (name) {
        best = Math.max(best, similarity(folded, normalizeCardName(name)))
      }
    }
  }
  return best
}

/**
 * The lines with every pair of neighbours that is one card joined into one line, the first line's
 * quantity kept. A line that has a quantity of its own starts a new card, so it is never joined to
 * the line before it.
 */
export function joinSpokenLines(db: Db, lines: readonly string[]): string[] {
  const out: string[] = []
  for (let at = 0; at < lines.length; at += 1) {
    const first = lines[at]!
    const next = lines[at + 1]
    if (next !== undefined && !QUANTITY.test(next)) {
      const match = QUANTITY.exec(first)
      const firstName = match ? match[2]! : first
      const joinedName = `${firstName} ${next}`
      const halves = [closestNameSimilarity(db, firstName), closestNameSimilarity(db, next)]
      const together = closestNameSimilarity(db, joinedName)
      const clearlyBetter = together >= Math.max(...halves) + JOIN_ADVANTAGE
      const oneHalfIsAFragment = together >= NEARLY_EXACT && Math.min(...halves) < FRAGMENT_BELOW
      if (together >= MIN_JOINED_SIMILARITY && (clearlyBetter || oneHalfIsAFragment)) {
        out.push(match ? `${match[1]}x ${joinedName}` : joinedName)
        at += 1
        continue
      }
    }
    out.push(first)
  }
  return out
}
