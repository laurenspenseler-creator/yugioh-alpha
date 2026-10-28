// Dictated card lines, put together again where the recognizer cut one name in two (ADR 0040).
// A name with a dash or a comma in it ("Schwarz Glänzender Soldat - Gesandter des Anfangs") is
// said with a pause and written as two lines; each half then matches some other card or none.
// Two neighbouring lines are one card when the two together are clearly closer to a card name
// than either is alone, or when neither is a card name and together they sound like one
// ("Magic" and "Gemma" for "Magic Jammer").
import { inArray } from 'drizzle-orm'
import type { useDb } from '../db'
import { catalogCard } from '../db/schema'
import { quantityOf } from '../../shared/spoken-quantity'
import { normalizeCardName, similarity, suggestCatalogMatches } from './card-entry'
import { closestBySound, closestCards } from './card-fragments'

type Db = ReturnType<typeof useDb>

/** More lines or longer lines than this are not a dictation (a recognizer that writes no commas makes one long line). */
export const MAX_SPOKEN_LINES = 80
export const MAX_SPOKEN_LINE_LENGTH = 3000

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
/**
 * Neither half is a card name when both are below this by letters ("The Six Samurai" is 0.86 close to "The Six Samurai - Irou",
 * but only the start of a family of names); together they must sound this like a name.
 */
const NOT_A_NAME_BELOW = 0.9
const MIN_SOUND_JOIN = 0.7
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

/** A line this long may be several cards said one after the other: Whisper writes a comma at every pause, so a stretch of fewer words is one card, however garbled ("Jomagna das Feuer von Tom"). */
const RUN_ON_MIN_WORDS = 7
/** The most words of one card name. */
const MAX_NAME_WORDS = 7
/** A stretch of words is a card from this similarity to a name on, and must beat the base to be worth a line of its own. */
const SEGMENT_FLOOR = 0.62
const SEGMENT_BASE = 0.55
const LONGER_STRETCH_BONUS = 0.08
/**
 * A stretch of several words that is exactly a card name beats a cut into two cards that each match part of it
 * ("Vermächtnis von" and "Yatagarasu", both names of other cards, for "Vermächtnis von Yatagarasu").
 */
const EXACT_STRETCH = 0.95
const EXACT_STRETCH_BONUS = 0.25
/** A line that is as close as this to one card name as a whole is one card, however many words. */
const WHOLE_NAME = 0.85

/**
 * A line with no break in it, said as one card after the other ("Topf der Gier Raigeki Brecher
 * Bodenlose Fallgrube"), cut into one line per card: the way of cutting it into stretches that
 * are closest to card names, where a stretch has to be at least `SEGMENT_FLOOR` close to one and
 * the closer the better. A number word before a card becomes its quantity; words that are no
 * card stay as a line of their own (the review shows them as unknown). A line that is a card name
 * as a whole, or too short to be several, stays as it is.
 */
export function splitRunOnLine(db: Db, line: string): string[] {
  const words = line.trim().split(/\s+/).filter(word => word !== '')
  if (words.length < RUN_ON_MIN_WORDS) {
    return [line]
  }
  const closeness = new Map<string, number>()
  const score = (from: number, to: number): number => {
    const key = `${from}-${to}`
    let known = closeness.get(key)
    if (known === undefined) {
      known = closestCards(db, words.slice(from, to).join(' '), 1)[0]?.score ?? 0
      closeness.set(key, known)
    }
    return known
  }
  if (score(0, words.length) >= WHOLE_NAME) {
    return [line]
  }

  // best[i]: the best total for the first i words; start[i]: where the stretch that ends at i begins (-1: word i-1 is no card)
  const best: number[] = [0]
  const start: number[] = [-1]
  for (let end = 1; end <= words.length; end += 1) {
    best[end] = best[end - 1]!
    start[end] = -1
    for (let length = 1; length <= Math.min(MAX_NAME_WORDS, end); length += 1) {
      const closeness = score(end - length, end)
      // A longer stretch wins over a shorter one inside it that is a little closer ("Vermächtnis von Yata-Garasu" over "Yata-Garasu").
      const value = closeness - SEGMENT_BASE + LONGER_STRETCH_BONUS * Math.min(length - 1, 3)
        + (length > 1 && closeness >= EXACT_STRETCH ? EXACT_STRETCH_BONUS : 0)
      if (closeness >= SEGMENT_FLOOR && best[end - length]! + value > best[end]!) {
        best[end] = best[end - length]! + value
        start[end] = end - length
      }
    }
  }

  const pieces: Array<{ text: string, card: boolean }> = []
  for (let end = words.length; end > 0;) {
    const from = start[end]!
    if (from < 0) {
      pieces.unshift({ text: words[end - 1]!, card: false })
      end -= 1
    }
    else {
      pieces.unshift({ text: words.slice(from, end).join(' '), card: true })
      end = from
    }
  }
  if (!pieces.some(piece => piece.card)) {
    return [line]
  }

  // Words between cards: a number word is the quantity of the next card, the rest a line of its own when it is more than a filler.
  const lines: string[] = []
  let stray: string[] = []
  const flush = () => {
    if (stray.length > 0 && /\p{L}{3,}/u.test(stray.join(' '))) {
      lines.push(stray.join(' '))
    }
    stray = []
  }
  for (const piece of pieces) {
    if (!piece.card) {
      stray.push(piece.text)
      continue
    }
    const quantity = stray.length > 0 ? quantityOf(stray.at(-1)!) : null
    if (quantity !== null) {
      stray.pop()
    }
    flush()
    lines.push(quantity !== null && quantity > 1 ? `${quantity}x ${piece.text}` : piece.text)
  }
  flush()
  return lines
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
  return joinNeighbours(db, lines.flatMap(line => splitRunOnLine(db, line)))
}

function joinNeighbours(db: Db, lines: readonly string[]): string[] {
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
