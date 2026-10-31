// A card name compared word by word. The letter similarity of the whole name (card-entry.ts) cannot tell
// that "Gaia der wilde Ritter" is "Gaia, zorniger Ritter": the one word that differs is a synonym, and the
// rest of the name is the same. Here a name is a list of words; the words both names have count, longer
// words more than shorter ones, a stem or a synonym counts a little less, and filler words count nothing.

import { foldCardName } from './card-name-fold'

/** Words that carry no part of a name: articles and small joining words, German and English. */
const FILLER = new Set([
  'der', 'die', 'das', 'des', 'dem', 'den', 'ein', 'eine', 'einer', 'eines', 'einem', 'einen', 'und', 'von', 'vom', 'zu', 'zum', 'zur', 'im', 'in', 'am', 'an', 'auf',
  'the', 'of', 'a', 'an', 'and', 'to', 'in', 'on',
])

/**
 * Words that a person writes for each other (and that the translations of one English word differ in):
 * "Fierce Knight" is "wilder" or "zorniger Ritter". Folded stems, so every ending is covered.
 */
const SYNONYM_GROUPS: ReadonlyArray<readonly string[]> = [
  ['wild', 'zornig', 'wutend', 'grimmig', 'heftig', 'rasend', 'fierce'],
  ['gross', 'riesig', 'gigantisch', 'giant', 'great'],
  ['klein', 'winzig', 'little', 'small', 'mini'],
  ['dunkel', 'finster', 'schwarz', 'dark'],
  ['heilig', 'geweiht', 'holy', 'sacred'],
]

/** A word matches another that starts with the same letters up to this length (an ending is not a different word). */
const STEM_LENGTH = 5
/** What a stem match and a synonym are worth next to an equal word. */
const STEM_WEIGHT = 0.85
const SYNONYM_WEIGHT = 0.7
/** A compound that ends with the word ("Polarritter" with "Ritter") is a partial match. */
const COMPOUND_WEIGHT = 0.4
const MIN_COMPOUND_PART = 5

/** Whether a word (any case) is filler, so it is no use for finding a name. */
export function isFillerWord(word: string): boolean {
  return FILLER.has(foldCardName(word))
}

/** The words of a name or a query, folded (no case, no accents, no ß), without the filler. */
export function nameWords(name: string): string[] {
  return name
    .split(/[^\p{L}\p{N}]+/u)
    .map(word => foldCardName(word))
    .filter(word => word.length >= 2 && !FILLER.has(word))
}

function synonymGroupOf(word: string): number {
  return SYNONYM_GROUPS.findIndex(group => group.some(stem => word.startsWith(stem)))
}

/** How alike two folded words are, 0..1: equal 1, same stem or synonym a little less, compound the least. */
export function wordMatch(a: string, b: string): number {
  if (a === b) {
    return 1
  }
  const stem = Math.min(STEM_LENGTH, a.length, b.length)
  if (stem >= 4 && a.slice(0, stem) === b.slice(0, stem) && Math.abs(a.length - b.length) <= 4) {
    return STEM_WEIGHT
  }
  const groupA = synonymGroupOf(a)
  if (groupA >= 0 && groupA === synonymGroupOf(b)) {
    return SYNONYM_WEIGHT
  }
  const [short, long] = a.length <= b.length ? [a, b] : [b, a]
  if (short.length >= MIN_COMPOUND_PART && long.length > short.length && long.endsWith(short)) {
    return COMPOUND_WEIGHT
  }
  return 0
}

/**
 * The words two names share, as a Sørensen–Dice score (0..1) weighted by the length of the words: a long
 * word that is the same says more than a short one. Every word is matched at most once, best matches first.
 */
export function wordOverlap(queryWords: readonly string[], nameWords: readonly string[]): number {
  if (queryWords.length === 0 || nameWords.length === 0) {
    return 0
  }
  const pairs: Array<{ q: number, n: number, match: number }> = []
  queryWords.forEach((q, qi) => {
    nameWords.forEach((n, ni) => {
      const match = wordMatch(q, n)
      if (match > 0) {
        pairs.push({ q: qi, n: ni, match })
      }
    })
  })
  pairs.sort((x, y) => y.match * Math.max(queryWords[y.q]!.length, nameWords[y.n]!.length) - x.match * Math.max(queryWords[x.q]!.length, nameWords[x.n]!.length))
  const usedQuery = new Set<number>()
  const usedName = new Set<number>()
  let shared = 0
  for (const pair of pairs) {
    if (usedQuery.has(pair.q) || usedName.has(pair.n)) {
      continue
    }
    usedQuery.add(pair.q)
    usedName.add(pair.n)
    shared += pair.match * (queryWords[pair.q]!.length + nameWords[pair.n]!.length) / 2
  }
  const total = queryWords.reduce((sum, word) => sum + word.length, 0) + nameWords.reduce((sum, word) => sum + word.length, 0)
  return (2 * shared) / total
}
