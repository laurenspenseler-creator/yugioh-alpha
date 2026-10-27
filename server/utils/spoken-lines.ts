// Dictated card lines, put together again where the recognizer cut one name in two (ADR 0040).
// A name with a dash or a comma in it ("Schwarz Glänzender Soldat - Gesandter des Anfangs") is
// said with a pause and written as two lines; each half then matches some other card or none.
// Two neighbouring lines are one card when the two together are clearly closer to a card name
// than either is alone, or when neither is a card name and together they sound like one
// ("Magic" and "Gemma" for "Magic Jammer").
import { inArray } from 'drizzle-orm'
import type { useDb } from '../db'
import { catalogCard } from '../db/schema'
import { normalizeCardName, similarity, suggestCatalogMatches } from './card-entry'
import { closestBySound } from './card-fragments'

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
/** Neither half is a card name when both are below this by letters; together they must sound this like a name. */
const NOT_A_NAME_BELOW = 0.85
const MIN_SOUND_JOIN = 0.75
/** "Magic Gemma" has three consonants (m, k, m): enough here, because the whole sound must be a name's. */
const SOUND_JOIN_MIN_CONSONANTS = 3

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

/** The English name of the card a text sounds like (the whole sound, not just a part), the one nearest by letters when several do; null if none. */
function nameBySound(db: Db, text: string): string | null {
  const sounding = closestBySound(db, text, 5, SOUND_JOIN_MIN_CONSONANTS).filter(hit => hit.score >= MIN_SOUND_JOIN)
  const names = sounding.length === 0
    ? []
    : db.select({ name: catalogCard.name }).from(catalogCard).where(inArray(catalogCard.id, sounding.map(hit => hit.cardId))).all().map(row => row.name)
  const folded = normalizeCardName(text)
  return names.sort((a, b) => similarity(folded, normalizeCardName(b)) - similarity(folded, normalizeCardName(a)))[0] ?? null
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
      // Neither half is a name, but together they sound like one: the line becomes that card's name, because
      // the lookup would not find it by the spelling ("Magic Gemma").
      const heard = Math.max(...halves) < NOT_A_NAME_BELOW ? nameBySound(db, joinedName) : null
      if (heard) {
        out.push(match ? `${match[1]}x ${heard}` : heard)
        at += 1
        continue
      }
    }
    out.push(first)
  }
  return out
}
