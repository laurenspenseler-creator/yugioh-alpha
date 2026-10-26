// Which cards a photo shows, from the text an on-device OCR read from it
// (ADR 0040). OCR of a photo of several cards returns everything printed on
// them: the names, but also the effect texts, which are full of words that look
// like short card names ("monster", "battle") and of other cards' names in
// quotes. What tells a card's own name apart:
//
//  - it is printed larger than the effect text, so the client sends how tall
//    each word is relative to the photo's usual word (`heights`, 1 = the usual);
//  - it is not made of everyday card-text words ("monster", "spell"), which are in
//    thousands of card texts, unless it matches a whole name exactly;
//  - a card's name is often read again where its own text quotes it.
//
// Every run of up to eight words is scored against the English and German card
// names with a bigram similarity (Sørensen–Dice, like the quick capture,
// ADR 0003); a window close enough to a name, and big enough, is a card. The
// page then hands the cards to the usual review table, which is where doubtful
// ones are settled.

import { eq, isNull } from 'drizzle-orm'
import type { useDb } from '../db'
import { catalogCard, catalogCardTranslation } from '../db/schema'
import { SURE_SCORE } from '../../shared/card-photo'
import { foldCardName as normalizeCardName } from '../../shared/card-name-fold'

type Db = ReturnType<typeof useDb>

/** Readings and lines one request may carry: a photo's reading is a few hundred lines. */
export const MAX_FRAGMENT_PASSES = 4
export const MAX_FRAGMENTS_PER_PASS = 600
export const MAX_FRAGMENT_LENGTH = 300

/** A window is a candidate from this similarity on. */
export const MIN_FRAGMENT_SCORE = 0.62
/** The page calls a card sure from here (`shared/card-photo.ts`); below, the review table shows it as doubtful. */
export { SURE_SCORE }
/** A window this close to a whole name counts even when its words are everyday ones. */
export const EXACT_SCORE = 0.97
/** A name printed at least this much taller than the usual word of the photo is a header. */
export const HEADER_SIZE = 1.5
/** A word in more than this many card texts is an everyday word. */
export const EVERYDAY_WORD_TEXTS = 150
/** The same card read this often with a score this high is a card even without the header size. */
const REPEAT_SCORE = 0.92
const REPEAT_COUNT = 2

/** Words in the longest window tried: the longest card names have about eight. */
const MAX_WINDOW_WORDS = 8
/** Windows shorter than this (after folding) match too many names by chance. */
const MIN_FOLDED_LENGTH = 5
const MAX_FOLDED_LENGTH = 70
/** Two names must share at least this many bigrams before they are compared at all. */
const MIN_SHARED_GRAMS = 3
/** A longer window beats a shorter one that scores up to this much higher, per extra word. */
const LONGER_BONUS = 0.04

/**
 * A line of OCR text. `heights[i]` is how tall word `i` (split on white space)
 * is, relative to the usual word of the photo; without it every line counts as
 * having the header size.
 */
export interface OcrLine {
  text: string
  heights?: number[]
}

export interface FragmentMatch {
  cardId: number
  /** The English catalog name (canonical). */
  name: string
  /** The text of the window that matched best, as it was read. */
  text: string
  score: number
  /** Copies seen: the most any single pass saw, because the passes read the same photo. */
  count: number
}

interface NameIndex {
  entries: Array<{ cardId: number, gramCount: number, key: string }>
  names: Map<number, string>
  postings: Map<string, number[]>
  /** In how many card texts (English and German) each word of three letters or more is; read from the texts on first use. */
  textCount: Map<string, number> | null
  /** Scratch space for `rankMatches`: shared bigrams per entry, zeroed again after every use. */
  shared: Uint16Array
}

function bigramSet(folded: string): string[] {
  const grams = new Set<string>()
  for (let i = 0; i < folded.length - 1; i += 1) {
    grams.add(folded.slice(i, i + 2))
  }
  return [...grams]
}

function wordsOf(text: string): string[] {
  return text.toLowerCase().match(/\p{L}{3,}/gu) ?? []
}

const INDEX_TTL_MS = 10 * 60 * 1000
const indexes = new WeakMap<object, { index: NameIndex, builtAt: number }>()

/** The folded English and German names of the catalog as an inverted index of their bigrams. */
function nameIndex(db: Db): NameIndex {
  const cached = indexes.get(db)
  if (cached && Date.now() - cached.builtAt < INDEX_TTL_MS) {
    return cached.index
  }

  const index: NameIndex = { entries: [], names: new Map(), postings: new Map(), textCount: null, shared: new Uint16Array(0) }
  const add = (cardId: number, folded: string) => {
    if (folded.length < MIN_FOLDED_LENGTH) {
      return
    }
    const grams = bigramSet(folded)
    const entryIndex = index.entries.length
    index.entries.push({ cardId, gramCount: grams.length, key: phoneticKey(folded) })
    for (const gram of grams) {
      const list = index.postings.get(gram)
      if (list) {
        list.push(entryIndex)
      }
      else {
        index.postings.set(gram, [entryIndex])
      }
    }
  }

  for (const row of db.select({ id: catalogCard.id, name: catalogCard.name, nameSearch: catalogCard.nameSearch }).from(catalogCard).where(isNull(catalogCard.retiredAt)).all()) {
    index.names.set(row.id, row.name)
    add(row.id, row.nameSearch || normalizeCardName(row.name))
  }
  for (const row of db
    .select({ cardId: catalogCardTranslation.cardId, nameSearch: catalogCardTranslation.nameSearch })
    .from(catalogCardTranslation)
    .where(eq(catalogCardTranslation.locale, 'de'))
    .all()) {
    if (index.names.has(row.cardId)) {
      add(row.cardId, row.nameSearch)
    }
  }

  index.shared = new Uint16Array(index.entries.length)
  indexes.set(db, { index, builtAt: Date.now() })
  return index
}

/** How common each word is in the card texts: only the photo matcher needs it, so it is read on first use. */
function textCounts(db: Db, index: NameIndex): Map<string, number> {
  if (index.textCount) {
    return index.textCount
  }
  const counts = new Map<string, number>()
  const countWords = (text: string | null) => {
    for (const word of new Set(wordsOf(text ?? ''))) {
      counts.set(word, (counts.get(word) ?? 0) + 1)
    }
  }
  for (const row of db.select({ desc: catalogCard.desc }).from(catalogCard).where(isNull(catalogCard.retiredAt)).all()) {
    countWords(row.desc)
  }
  for (const row of db.select({ cardId: catalogCardTranslation.cardId, desc: catalogCardTranslation.desc }).from(catalogCardTranslation).where(eq(catalogCardTranslation.locale, 'de')).all()) {
    if (index.names.has(row.cardId)) {
      countWords(row.desc)
    }
  }
  index.textCount = counts
  return counts
}

/** The names closest to a folded text, best first, each card once: card id and Sørensen–Dice score over bigram sets. */
function rankMatches(index: NameIndex, folded: string, limit: number): Array<{ cardId: number, score: number }> {
  const grams = bigramSet(folded)
  if (grams.length < MIN_SHARED_GRAMS) {
    return []
  }

  // Shared bigrams per name, counted in a typed array (a Map here made a page of OCR lines take minutes).
  const { shared } = index
  const touched: number[] = []
  for (const gram of grams) {
    const postings = index.postings.get(gram)
    if (!postings) {
      continue
    }
    for (const entryIndex of postings) {
      if (shared[entryIndex]!++ === 0) {
        touched.push(entryIndex)
      }
    }
  }

  const bestByCard = new Map<number, number>()
  for (const entryIndex of touched) {
    const sharedCount = shared[entryIndex]!
    shared[entryIndex] = 0
    if (sharedCount < MIN_SHARED_GRAMS) {
      continue
    }
    const entry = index.entries[entryIndex]!
    const score = (2 * sharedCount) / (grams.length + entry.gramCount)
    if (score > (bestByCard.get(entry.cardId) ?? 0)) {
      bestByCard.set(entry.cardId, score)
    }
  }
  return [...bestByCard].map(([cardId, score]) => ({ cardId, score })).sort((a, b) => b.score - a.score).slice(0, limit)
}

/** The best name for a folded window: card id and Sørensen–Dice score over bigram sets, or null. */
function bestMatch(index: NameIndex, folded: string): { cardId: number, score: number } | null {
  return rankMatches(index, folded, 1)[0] ?? null
}

// --- By sound: what a speech recognizer writes for a name it did not know ------------

/** Voiced and unvoiced consonants, and the ones German and English spell alike, as one class. */
const CONSONANT_CLASS: Record<string, string> = { b: 'p', p: 'p', d: 't', t: 't', g: 'k', k: 'k', c: 'k', q: 'k', f: 'f', v: 'f', w: 'f', s: 's', z: 's' }
const DIGRAPHS: ReadonlyArray<readonly [RegExp, string]> = [[/sch/g, 's'], [/ph/g, 'f'], [/ch/g, 'k'], [/ck/g, 'k'], [/tz/g, 's'], [/th/g, 't'], [/dt/g, 't'], [/qu/g, 'k'], [/x/g, 'ks']]

/**
 * The consonant skeleton of a folded name: its sound without the vowels, which a recognizer
 * and a spelling disagree on most ("goldzakofak" and "goldsarkophag" both become "kltskfk"-ish,
 * "makes c" and "maxx c" share "mksk").
 */
export function phoneticKey(folded: string): string {
  let text = folded
  for (const [pattern, replacement] of DIGRAPHS) {
    text = text.replace(pattern, replacement)
  }
  let key = ''
  for (const char of text) {
    if ('aeiouyh'.includes(char)) {
      continue
    }
    const sound = CONSONANT_CLASS[char] ?? char
    if (key.at(-1) !== sound) {
      key += sound
    }
  }
  return key
}

/** Edit distance of two short strings, giving up above `max`. */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) {
    return max + 1
  }
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i]
    let smallest = i
    for (let j = 1; j <= b.length; j += 1) {
      const value = Math.min(previous[j]! + 1, row[j - 1]! + 1, previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1))
      row.push(value)
      smallest = Math.min(smallest, value)
    }
    if (smallest > max) {
      return max + 1
    }
    previous = row
  }
  return previous[b.length]!
}

/** A skeleton shorter than this matches too many names by chance. */
const MIN_KEY_LENGTH = 4
/** The skeletons of two names may differ by this share of the longer one, at most. */
const MAX_KEY_DIFFERENCE = 0.25
/** A match by sound is a guess: it never scores above this, so it is never taken for sure. */
const SOUND_SCORE_CEILING = 0.8
/** Below this best score by letters, names are compared by sound too. */
const SOUND_SEARCH_BELOW = 0.6

function rankBySound(index: NameIndex, folded: string, limit: number): Array<{ cardId: number, score: number }> {
  const key = phoneticKey(folded)
  if (key.length < MIN_KEY_LENGTH) {
    return []
  }
  const bestByCard = new Map<number, number>()
  for (const entry of index.entries) {
    if (entry.key.length < MIN_KEY_LENGTH) {
      continue
    }
    const longest = Math.max(key.length, entry.key.length)
    const distance = editDistance(key, entry.key, Math.floor(longest * MAX_KEY_DIFFERENCE))
    if (distance > longest * MAX_KEY_DIFFERENCE) {
      continue
    }
    // Same skeleton: just under the ceiling; every edit takes more off.
    const score = SOUND_SCORE_CEILING - (distance / longest) * 0.6
    if (score > (bestByCard.get(entry.cardId) ?? 0)) {
      bestByCard.set(entry.cardId, score)
    }
  }
  return [...bestByCard].map(([cardId, score]) => ({ cardId, score })).sort((a, b) => b.score - a.score).slice(0, limit)
}

/**
 * The cards whose English or German names are closest to a text, by bigram similarity over
 * the whole catalog. A word that was misheard or misread ("Goldzarkofack") shares no word
 * with the name, so the quick capture's lookup by words finds nothing; this finds it by
 * its letters, and where even the letters differ ("Goldzakofak", "Makes C") by its sound.
 */
export function closestCards(db: Db, text: string, limit: number): Array<{ cardId: number, score: number }> {
  const index = nameIndex(db)
  const folded = normalizeCardName(text)
  const byLetters = rankMatches(index, folded, limit)
  if ((byLetters[0]?.score ?? 0) >= SOUND_SEARCH_BELOW) {
    return byLetters
  }
  const merged = new Map(byLetters.map(hit => [hit.cardId, hit.score]))
  for (const hit of rankBySound(index, folded, limit)) {
    merged.set(hit.cardId, Math.max(merged.get(hit.cardId) ?? 0, hit.score))
  }
  return [...merged].map(([cardId, score]) => ({ cardId, score })).sort((a, b) => b.score - a.score).slice(0, limit)
}

/** The least common word of a text, as the number of card texts it is in (words of fewer than three letters count as rare). */
function rarestWordCount(counts: Map<string, number>, text: string): number {
  const words = wordsOf(text)
  return words.length === 0 ? 0 : Math.min(...words.map(word => counts.get(word) ?? 0))
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? 1
}

interface WindowMatch {
  start: number
  end: number
  cardId: number
  score: number
  text: string
  /** How tall the window's words are, relative to the photo's usual word. */
  size: number
  /** The window's rarest word is in this many card texts. */
  everyday: number
}

/** The non-overlapping windows of one OCR line that are card names, best first taken. */
function matchLine(index: NameIndex, counts: Map<string, number>, line: OcrLine): WindowMatch[] {
  // Words without a letter or digit carry no name; they go with their height.
  const words: Array<{ word: string, height: number }> = []
  line.text.split(/\s+/).forEach((word, position) => {
    if (/[\p{L}\p{N}]/u.test(word)) {
      words.push({ word, height: line.heights?.[position] ?? HEADER_SIZE })
    }
  })

  const found: WindowMatch[] = []
  for (let start = 0; start < words.length; start += 1) {
    for (let end = start + 1; end <= Math.min(words.length, start + MAX_WINDOW_WORDS); end += 1) {
      const text = words.slice(start, end).map(entry => entry.word).join(' ')
      const folded = normalizeCardName(text)
      if (folded.length < MIN_FOLDED_LENGTH) {
        continue
      }
      if (folded.length > MAX_FOLDED_LENGTH) {
        break
      }
      const match = bestMatch(index, folded)
      if (match && match.score >= MIN_FRAGMENT_SCORE) {
        found.push({
          start,
          end,
          cardId: match.cardId,
          score: match.score,
          text,
          size: median(words.slice(start, end).map(entry => entry.height)),
          everyday: rarestWordCount(counts, text),
        })
      }
    }
  }

  // Highest score first, with a bonus for every extra word (a one-word window "Magician"
  // must not beat "Dar Magician"), and no word used twice.
  const rank = (window: WindowMatch) => window.score + LONGER_BONUS * (window.end - window.start - 1)
  found.sort((a, b) => rank(b) - rank(a))
  const taken: WindowMatch[] = []
  const used = new Set<number>()
  for (const candidate of found) {
    let free = true
    for (let word = candidate.start; word < candidate.end; word += 1) {
      if (used.has(word)) {
        free = false
        break
      }
    }
    if (free) {
      taken.push(candidate)
      for (let word = candidate.start; word < candidate.end; word += 1) {
        used.add(word)
      }
    }
  }
  return taken
}

/** Whether one window reads like the name printed on a card, not like a word of an effect text. */
function isHeader(window: WindowMatch): boolean {
  return window.size >= HEADER_SIZE && ((window.score >= SURE_SCORE && window.everyday <= EVERYDAY_WORD_TEXTS) || window.score >= EXACT_SCORE)
}

/**
 * The cards found in the OCR text of one photo. `passes` are the lines of each
 * reading of the photo (a second reading with another page mode or threshold
 * finds names the first missed). A card counts when a window read like its
 * printed name (`isHeader`) in some pass, or when it was read twice with a very
 * high score (a name repeated where the card's own text quotes it); it counts
 * as many copies as the busiest single pass saw its name.
 */
export function matchFragments(db: Db, passes: Array<Array<string | OcrLine>>): FragmentMatch[] {
  const index = nameIndex(db)
  const counts = textCounts(db, index)
  const byCard = new Map<number, FragmentMatch & { headers: number, repeats: number }>()

  for (const lines of passes) {
    const seen = new Map<number, { headers: number, repeats: number, score: number, text: string }>()
    for (const raw of lines) {
      for (const window of matchLine(index, counts, typeof raw === 'string' ? { text: raw } : raw)) {
        const entry = seen.get(window.cardId) ?? { headers: 0, repeats: 0, score: 0, text: window.text }
        if (isHeader(window)) {
          entry.headers += 1
        }
        if (window.score >= REPEAT_SCORE && window.everyday <= EVERYDAY_WORD_TEXTS) {
          entry.repeats += 1
        }
        if (window.score > entry.score) {
          entry.score = window.score
          entry.text = window.text
        }
        seen.set(window.cardId, entry)
      }
    }

    for (const [cardId, entry] of seen) {
      const known = byCard.get(cardId)
      if (known) {
        known.headers = Math.max(known.headers, entry.headers)
        known.repeats = Math.max(known.repeats, entry.repeats)
        if (entry.score > known.score) {
          known.score = entry.score
          known.text = entry.text
        }
      }
      else {
        byCard.set(cardId, { cardId, name: index.names.get(cardId) ?? '', text: entry.text, score: entry.score, count: 0, headers: entry.headers, repeats: entry.repeats })
      }
    }
  }

  return [...byCard.values()]
    .filter(match => match.headers > 0 || match.repeats >= REPEAT_COUNT)
    // Quotes of the card's own name in its text are not copies: only printed names count.
    .map(({ headers, repeats: _repeats, ...match }) => ({ ...match, count: Math.max(1, headers) }))
    .sort((a, b) => b.count - a.count || b.score - a.score || a.name.localeCompare(b.name))
}
