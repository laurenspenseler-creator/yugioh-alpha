// @vitest-environment node
// The arithmetic of recognizing a card by its artwork (ADR 0041): index format, correction, matching, windows, hits.
import { describe, expect, it } from 'vitest'
import {
  ART_DIMENSION,
  ART_MIN_MARGIN,
  ART_MIN_SIMILARITY,
  ART_MIN_SUPPORT,
  ART_PARTS,
  ART_SURE_MARGIN,
  ART_SURE_SIMILARITY,
  ART_SURE_SUPPORT,
  ART_VECTOR,
  artPlaces,
  artVectorFromTokens,
  artWindows,
  bestMatch,
  cardsFromHits,
  centerArtIndex,
  correctForPhoto,
  matchFromSimilarities,
  meanVector,
  normalize,
  parseArtIndex,
  photoCorrection,
  quantizeArtVector,
  quantizeVector,
  refinementCandidates,
  refinementWindows,
  similarities,
} from '../../shared/card-art'
import type { ArtHit, ArtIndexMeta } from '../../shared/card-art'

/** A repeatable pseudo-random unit vector of one part. */
function part(seed: number): Float32Array {
  const out = new Float32Array(ART_DIMENSION)
  let state = seed * 2654435761 % 4294967296
  for (let i = 0; i < ART_DIMENSION; i += 1) {
    state = (state * 1664525 + 1013904223) % 4294967296
    out[i] = state / 4294967296 - 0.5
  }
  return normalize(out)
}

/** A whole vector (both parts): the same pseudo-random direction in each, shifted for the second. */
function vector(seed: number): Float32Array {
  const out = new Float32Array(ART_VECTOR)
  out.set(part(seed), 0)
  out.set(part(seed + 1000), ART_DIMENSION)
  return out
}

/** `vector(seed)` with a share of `other` mixed in: a vector at a known angle from the first. */
function mixed(seed: number, other: number, share: number): Float32Array {
  const a = vector(seed)
  const b = vector(other)
  const out = new Float32Array(ART_VECTOR)
  for (let p = 0; p < ART_PARTS; p += 1) {
    out.set(normalize(a.slice(p * ART_DIMENSION, (p + 1) * ART_DIMENSION).map((value, i) => value * (1 - share) + b[p * ART_DIMENSION + i]! * share)), p * ART_DIMENSION)
  }
  return out
}

/** An index of the given vectors, in the stored format. */
function buildIndex(entries: Array<{ cardId: number, vector: Float32Array }>) {
  const count = entries.length
  const meta: ArtIndexMeta = { version: 2, model: 'test', dimension: ART_DIMENSION, parts: ART_PARTS, count, cardIds: entries.map(entry => entry.cardId) }
  const binary = new ArrayBuffer(count * ART_PARTS * 4 + count * ART_VECTOR)
  const scales = new Float32Array(binary, 0, count * ART_PARTS)
  const values = new Int8Array(binary, count * ART_PARTS * 4, count * ART_VECTOR)
  entries.forEach((entry, i) => {
    const quantized = quantizeArtVector(entry.vector)
    scales.set(quantized.scales, i * ART_PARTS)
    values.set(quantized.values, i * ART_VECTOR)
  })
  return { meta, binary }
}

/** Catalog vectors around a shared direction, like real artworks: `shared` of the common vector, the rest their own. */
function catalog(count: number, shared: number) {
  return Array.from({ length: count }, (_, i) => ({ cardId: i + 1, vector: mixed(i + 1, 9999, shared) }))
}

describe('quantizeVector', () => {
  it('keeps a unit vector close enough that its similarity with itself is still about 1', () => {
    const v = part(1)
    const { scale, values } = quantizeVector(v)

    let dot = 0
    for (let i = 0; i < ART_DIMENSION; i += 1) {
      dot += values[i]! * scale * v[i]!
    }
    expect(dot).toBeGreaterThan(0.999)
    expect(Math.max(...values)).toBeLessThanOrEqual(127)
  })

  it('quantizes the two parts of a vector on their own', () => {
    const v = vector(1)
    v.set(v.slice(ART_DIMENSION).map(value => value * 5), ART_DIMENSION)

    const { scales, values } = quantizeArtVector(v)

    expect(scales).toHaveLength(ART_PARTS)
    expect(scales[1]! / scales[0]!).toBeGreaterThan(3)
    expect(values).toHaveLength(ART_VECTOR)
    expect(Math.max(...values.slice(0, ART_DIMENSION))).toBeGreaterThan(100)
    expect(Math.max(...values.slice(ART_DIMENSION))).toBeGreaterThan(100)
  })
})

describe('artVectorFromTokens', () => {
  it('takes the class token and the mean of the patches, each as a unit vector', () => {
    // Three tokens of a picture: the class token, then two patches.
    const hidden = new Float32Array(3 * ART_DIMENSION)
    hidden.set(part(1), 0)
    hidden.set(part(2), ART_DIMENSION)
    hidden.set(part(3), 2 * ART_DIMENSION)

    const out = artVectorFromTokens(hidden, 0, 3)

    const classToken = out.slice(0, ART_DIMENSION)
    const patches = out.slice(ART_DIMENSION)
    expect(Array.from(classToken)).toEqual(Array.from(part(1)))
    const expected = normalize(part(2).map((value, i) => (value + part(3)[i]!) / 2))
    patches.forEach((value, i) => expect(value).toBeCloseTo(expected[i]!, 6))
    expect(Math.hypot(...patches)).toBeCloseTo(1, 5)
  })

  it('reads a picture that does not start at the beginning of the output (a batch)', () => {
    const hidden = new Float32Array(2 * 2 * ART_DIMENSION)
    hidden.set(part(1), 0)
    hidden.set(part(2), ART_DIMENSION)
    hidden.set(part(5), 2 * ART_DIMENSION)
    hidden.set(part(6), 3 * ART_DIMENSION)

    const second = artVectorFromTokens(hidden, 2 * ART_DIMENSION, 2)

    expect(Array.from(second.slice(0, ART_DIMENSION))).toEqual(Array.from(part(5)))
    expect(Array.from(second.slice(ART_DIMENSION))).toEqual(Array.from(part(6)))
  })
})

describe('parseArtIndex', () => {
  it('reads the scales and the values from the binary', () => {
    const { meta, binary } = buildIndex([{ cardId: 7, vector: vector(1) }, { cardId: 8, vector: vector(2) }])

    const index = parseArtIndex(meta, binary)

    expect(index.cardIds).toEqual([7, 8])
    expect(index.scales).toHaveLength(2 * ART_PARTS)
    expect(index.values).toHaveLength(2 * ART_VECTOR)
  })

  it('refuses an unknown format and a file that does not fit its description', () => {
    const { meta, binary } = buildIndex([{ cardId: 7, vector: vector(1) }])

    expect(() => parseArtIndex({ ...meta, version: 1 as never }, binary)).toThrow('Unknown')
    expect(() => parseArtIndex({ ...meta, dimension: 10 }, binary)).toThrow('Unknown')
    expect(() => parseArtIndex({ ...meta, parts: 1 }, binary)).toThrow('Unknown')
    expect(() => parseArtIndex({ ...meta, count: 2, cardIds: [7, 8] }, binary)).toThrow('incomplete')
    expect(() => parseArtIndex(meta, binary.slice(0, 100))).toThrow('incomplete')
  })
})

describe('centerArtIndex', () => {
  it('takes what all vectors share off them, so what is left of each is a unit vector without the common part', () => {
    const { meta, binary } = buildIndex(catalog(12, 0.7))
    const raw = parseArtIndex(meta, binary)

    const centered = centerArtIndex(raw)

    expect(centered.cardIds).toEqual(raw.cardIds)
    // Each part has a mean near zero over the catalog, and every part is still a unit vector.
    for (let p = 0; p < ART_PARTS; p += 1) {
      const mean = new Float64Array(ART_DIMENSION)
      for (let i = 0; i < 12; i += 1) {
        const scale = centered.scales[i * ART_PARTS + p]!
        let length = 0
        for (let d = 0; d < ART_DIMENSION; d += 1) {
          const value = centered.values[i * ART_VECTOR + p * ART_DIMENSION + d]! * scale
          mean[d]! += value / 12
          length += value * value
        }
        expect(Math.sqrt(length)).toBeCloseTo(1, 1)
      }
      expect(Math.hypot(...mean)).toBeLessThan(0.15)
    }
  })

  it('leaves an empty index alone', () => {
    const { meta, binary } = buildIndex([])

    expect(centerArtIndex(parseArtIndex(meta, binary)).cardIds).toEqual([])
  })
})

describe('correctForPhoto', () => {
  it('takes the shift all windows of the photo share off every window', () => {
    // Twelve windows that all lean 80 % towards the same direction (the photo's light and mat).
    const windows = Array.from({ length: 12 }, (_, i) => mixed(i + 1, 5000, 0.8))
    const direction = vector(5000)

    const corrected = correctForPhoto(windows)

    expect(corrected).toHaveLength(12)
    for (const window of corrected) {
      let along = 0
      for (let d = 0; d < ART_DIMENSION; d += 1) {
        along += window[d]! * direction[d]!
      }
      expect(Math.abs(along)).toBeLessThan(0.35)
      expect(Math.hypot(...window.slice(0, ART_DIMENSION))).toBeCloseTo(1, 4)
      expect(Math.hypot(...window.slice(ART_DIMENSION))).toBeCloseTo(1, 4)
    }
  })

  it('makes a window find its card again once the catalog is centred too', () => {
    const entries = catalog(40, 0.7)
    const { meta, binary } = buildIndex(entries)
    const index = centerArtIndex(parseArtIndex(meta, binary))
    // The photo: its windows show cards 3, 11, ... and all lean towards the photo's own shift.
    const windows = [3, 11, 17, 22, 28, 34, 5, 9, 13, 19, 25, 31].map(card => mixed(card, 7777, 0.6))

    const corrected = correctForPhoto(windows)

    const found = corrected.map(window => bestMatch(index, window)!.cardId)
    expect(found.filter((card, i) => card === [3, 11, 17, 22, 28, 34, 5, 9, 13, 19, 25, 31][i]).length).toBeGreaterThanOrEqual(10)
  })

  it('only normalizes when there are too few windows to tell the shift from the cards', () => {
    const corrected = correctForPhoto([vector(1), vector(2)])

    expect(Array.from(corrected[0]!)).toEqual(Array.from(vector(1)))
    expect(correctForPhoto([])).toEqual([])
  })

  it('gives the same result every time', () => {
    const windows = Array.from({ length: 16 }, (_, i) => vector(i + 1))

    expect(correctForPhoto(windows)).toEqual(correctForPhoto(windows))
  })
})

describe('bestMatch', () => {
  const entries = [
    { cardId: 1, vector: vector(1) },
    { cardId: 2, vector: vector(2) },
    { cardId: 3, vector: vector(3) },
    // An alternate artwork of card 1.
    { cardId: 1, vector: vector(4) },
  ]
  const built = buildIndex(entries)
  // Used as it is stored: the matching itself does not centre anything.
  const index = parseArtIndex(built.meta, built.binary)

  it('finds the card whose artwork the vector is, with a similarity near 1 and a wide margin', () => {
    const match = bestMatch(index, vector(2))!

    expect(match.cardId).toBe(2)
    expect(match.similarity).toBeGreaterThan(0.99)
    expect(match.margin).toBeGreaterThan(0.8)
  })

  it('finds a card by its alternate artwork too, and does not take its other artwork for a rival', () => {
    const match = bestMatch(index, mixed(4, 1, 0.3))!

    // Close to artwork 4 and a little toward artwork 1: both are card 1, so the margin is against card 2 or 3.
    expect(match.cardId).toBe(1)
    expect(match.margin).toBeGreaterThan(0.5)
  })

  it('has a small margin when two cards fit about equally', () => {
    const between = mixed(1, 2, 0.5)

    const match = bestMatch(index, between)!

    expect([1, 2]).toContain(match.cardId)
    expect(match.margin).toBeLessThan(0.05)
  })

  it('has nothing to say about an empty index', () => {
    const empty = parseArtIndex({ version: 2, model: 'test', dimension: ART_DIMENSION, parts: ART_PARTS, count: 0, cardIds: [] }, new ArrayBuffer(0))

    expect(bestMatch(empty, vector(1))).toBeNull()
  })
})

describe('similarities and matchFromSimilarities', () => {
  const built = buildIndex([
    { cardId: 1, vector: vector(1) },
    { cardId: 2, vector: vector(2) },
    { cardId: 1, vector: vector(3) },
  ])
  const index = parseArtIndex(built.meta, built.binary)

  it('gives the cosine of the query with every vector of the index, in its order', () => {
    const scores = similarities(index, vector(3))

    expect(scores).toHaveLength(3)
    expect(scores[2]).toBeGreaterThan(0.99)
    expect(scores[0]!).toBeLessThan(0.3)
  })

  it('picks the best card and the margin to the best other card from a list of scores', () => {
    // Card 1 has two vectors; its second one is the best, so card 2's value is the runner-up.
    const match = matchFromSimilarities([1, 2, 1], [0.2, 0.4, 0.9])

    expect(match).toEqual({ cardId: 1, similarity: 0.9, margin: expect.closeTo(0.5, 5) })
  })

  it('does not take another vector of the best card for a rival', () => {
    const match = matchFromSimilarities([1, 1, 2], [0.8, 0.79, 0.3])

    expect(match!.cardId).toBe(1)
    expect(match!.margin).toBeCloseTo(0.5, 5)
  })

  it('reads one window out of a longer list of scores', () => {
    const match = matchFromSimilarities([1, 2], [0.9, 0.1, 0.1, 0.7], 2)

    expect(match).toMatchObject({ cardId: 2, similarity: 0.7 })
    expect(match!.margin).toBeCloseTo(0.6, 5)
  })

  it('has nothing to say without scores', () => {
    expect(matchFromSimilarities([], [])).toBeNull()
  })
})

describe('photoCorrection', () => {
  it('corrects windows that were not part of the set it was learned from just like those that were', () => {
    const windows = Array.from({ length: 12 }, (_, i) => mixed(i + 1, 5000, 0.8))
    const correct = photoCorrection(windows)

    expect(Array.from(correct(windows[3]!))).toEqual(Array.from(correctForPhoto(windows)[3]!))
    // A new window is moved by the same mean and directions.
    const later = correct(mixed(77, 5000, 0.8))
    expect(Math.hypot(...later.slice(0, ART_DIMENSION))).toBeCloseTo(1, 4)
  })
})

describe('photoCorrection for photos of few cards', () => {
  /** Windows that show one picture (a card seen at many sizes and positions): they differ mostly along one direction. */
  const one = Array.from({ length: 40 }, (_, i) => mixed(7, 300, 0.1 + 0.3 * ((i * 7) % 10) / 10))
  /** Windows that show many different pictures. */
  const many = Array.from({ length: 40 }, (_, i) => vector(500 + i))
  const generic = normalize(vector(9000))

  it('uses the photo\'s own mean for many cards, and says so', () => {
    const correct = photoCorrection(many, 3, generic)

    expect(correct.own).toBe(1)
    expect(Array.from(correct(many[3]!))).toEqual(Array.from(photoCorrection(many)(many[3]!)))
  })

  it('leaves a card that fills the photo in the windows by using the mean of other photos instead', () => {
    const correct = photoCorrection(one, 3, generic)

    expect(correct.own).toBeLessThan(0.5)
    // With the photo's own mean the card would be gone: the corrected window would be about the noise, not the card.
    const kept = correct(one[0]!)
    const card = vector(7)
    let along = 0
    for (let d = 0; d < ART_DIMENSION; d += 1) {
      along += kept[d]! * card[d]!
    }
    expect(along).toBeGreaterThan(0.3)
  })

  it('does as before without a mean of other photos', () => {
    expect(photoCorrection(one).own).toBe(1)
  })

  it('averages vectors', () => {
    expect(Array.from(meanVector([Float32Array.of(1, 2), Float32Array.of(3, 6)]))).toEqual([2, 4])
    expect(meanVector([])).toHaveLength(0)
  })
})

describe('refinementWindows', () => {
  it('moves and zooms a window around itself, inside the picture, without the window itself', () => {
    const windows = refinementWindows({ x: 100, y: 100, size: 100 }, 1000, 1000)

    // 3 zooms × 3 × 3 shifts, minus the window itself
    expect(windows).toHaveLength(26)
    expect(windows.some(window => window.x === 100 && window.y === 100 && window.size === 100)).toBe(false)
    // zoomed in 15 %: 85 px, centred on the same centre when not shifted
    expect(windows).toContainEqual({ x: 108, y: 108, size: 85 })
    // zoomed out 20 %: 120 px
    expect(windows).toContainEqual({ x: 90, y: 90, size: 120 })
  })

  it('leaves out windows that would reach out of the picture', () => {
    const windows = refinementWindows({ x: 0, y: 0, size: 100 }, 130, 130)

    expect(windows.every(window => window.x >= 0 && window.y >= 0 && window.x + window.size <= 130 && window.y + window.size <= 130)).toBe(true)
    expect(windows.length).toBeLessThan(26)
  })
})

describe('artPlaces', () => {
  const hit = (margin: number, x: number, y = 0, size = 100): ArtHit => ({ cardId: 1, similarity: 0.5, margin, window: { x, y, size } })

  it('groups the hits near each other into one place, led by the clearest, and counts them', () => {
    const places = artPlaces([hit(0.1, 50), hit(0.2, 0), hit(0.15, 30, 20), hit(0.12, 500), hit(0.11, 520)])

    expect(places.map(place => [place.best.margin, place.support])).toEqual([[0.2, 3], [0.12, 2]])
  })

  it('has no places for no hits', () => {
    expect(artPlaces([])).toEqual([])
  })
})

describe('refinementCandidates', () => {
  const hit = (cardId: number, margin: number, x = 0): ArtHit => ({ cardId, similarity: 0.5, margin, window: { x, y: 0, size: 100 } })

  it('takes the clearest hit of every place of every card that is clear enough, the clearest first', () => {
    const candidates = refinementCandidates([hit(1, 0.05, 0), hit(1, 0.12, 50), hit(2, 0.2, 400), hit(3, 0.01, 800), hit(4, 0.07, 1200)])

    expect(candidates.map(candidate => [candidate.cardId, candidate.margin])).toEqual([[2, 0.2], [1, 0.12], [4, 0.07]])
    expect(candidates[1]!.window.x).toBe(50)
  })

  it('takes a card with copies at several places once for each place, up to three', () => {
    const candidates = refinementCandidates([hit(1, 0.2, 0), hit(1, 0.18, 500), hit(1, 0.16, 1000), hit(1, 0.14, 1500)])

    expect(candidates.map(candidate => candidate.window.x)).toEqual([0, 500, 1000])
  })

  it('looks at no more places than the limit', () => {
    const hits = Array.from({ length: 50 }, (_, i) => hit(i + 1, 0.05 + i / 1000, i * 200))

    expect(refinementCandidates(hits, 0.04, 10)).toHaveLength(10)
    expect(refinementCandidates(hits, 0.04, 10)[0]!.cardId).toBe(50)
  })
})

describe('artWindows', () => {
  it('lays windows of each size side by side, the last one at the edge', () => {
    const windows = artWindows(100, 70, [50], 1)

    // x: 0, 50; y: 0, then the last row ends at the edge (20) because a next one at 50 would not fit
    expect(windows.map(window => [window.x, window.y])).toEqual([[0, 0], [50, 0], [0, 20], [50, 20]])
  })

  it('leaves out a last row that would only add a thin strip', () => {
    expect(artWindows(100, 60, [50], 1).map(window => window.y)).toEqual([0, 0])
  })

  it('overlaps windows by half with a stride of 0.5, and skips sizes that do not fit', () => {
    const windows = artWindows(100, 100, [40, 120], 0.5)

    expect(windows.every(window => window.size === 40)).toBe(true)
    expect(windows.map(window => window.x).filter((x, i, all) => all.indexOf(x) === i)).toEqual([0, 20, 40, 60])
  })
})

describe('cardsFromHits', () => {
  const hit = (cardId: number, margin: number, x = 0, y = 0, size = 200, similarity = 0.5): ArtHit => ({ cardId, similarity, margin, window: { x, y, size } })
  /** `count` windows around one place of a card, the first with `margin`, each a little less clear. */
  const around = (cardId: number, margin: number, count: number, x = 0, similarity = 0.5): ArtHit[] =>
    Array.from({ length: count }, (_, i) => hit(cardId, margin - i * 0.001, x + i * 10, 0, 200, similarity))

  it('lists the cards that enough windows put clearly ahead of every other card, the clearest first, and says which are sure', () => {
    const cards = cardsFromHits([
      ...around(1, 0.2, 6),
      ...around(2, ART_MIN_MARGIN + 0.01, ART_MIN_SUPPORT, 400, 0.4),
    ])

    expect(cards.map(card => card.cardId)).toEqual([1, 2])
    expect(cards.map(card => card.sure)).toEqual([true, false])
    expect(ART_SURE_MARGIN).toBeGreaterThan(ART_MIN_MARGIN + 0.01)
  })

  it('leaves out a card that is matched by too few windows, too weakly, or not clearly enough', () => {
    const cards = cardsFromHits([
      ...around(3, 0.2, ART_MIN_SUPPORT - 1, 800),
      ...around(4, ART_MIN_MARGIN - 0.01, 8, 1200),
      ...around(5, 0.2, 8, 1600, ART_MIN_SIMILARITY - 0.01),
      hit(6, 0.3, 2000),
    ])

    expect(cards).toEqual([])
  })

  it('does not call a card sure that is not matched by enough windows or close enough, however clearly', () => {
    const cards = cardsFromHits([
      ...around(1, 0.3, ART_SURE_SUPPORT - 1),
      ...around(2, 0.3, 8, 400, ART_SURE_SIMILARITY - 0.01),
      ...around(3, ART_SURE_MARGIN - 0.01, 8, 800),
    ])

    expect(cards).toHaveLength(3)
    expect(cards.every(card => !card.sure)).toBe(true)
  })

  it('needs fewer windows per card when the support scale shrinks (a sparser look at the photo)', () => {
    const hits = [...around(1, 0.3, 4), ...around(2, 0.3, 3, 400)]

    const usual = cardsFromHits(hits)
    expect(usual.map(card => [card.cardId, card.sure])).toEqual([[1, false]])
    const sparse = cardsFromHits(hits, { supportScale: 0.65 })
    expect(sparse.map(card => [card.cardId, card.sure])).toEqual([[1, true], [2, false]])
  })

  it('takes the clearest hit of a card as its strength, even when weaker windows came first', () => {
    const [card] = cardsFromHits([hit(1, 0.1, 0, 0, 200, 0.4), hit(1, 0.25, 40, 30, 200, 0.55), hit(1, 0.2, 20, 20, 200, 0.5), hit(1, 0.16, 30, 10), hit(1, 0.12, 10, 20), hit(1, 0.11, 50, 40)])

    expect(card).toMatchObject({ cardId: 1, similarity: 0.55, margin: 0.25, copies: 1, support: 6, sure: true })
  })

  it('counts a card seen at places far apart as several copies, if each is shown by several windows and about as clear as the best', () => {
    const [card] = cardsFromHits([...around(1, 0.2, 4), ...around(1, 0.18, 3, 500), hit(1, 0.19, 0, 900), ...around(1, 0.09, 4, 1500), ...around(1, 0.15, 2, 2000)])

    // The lone window, the weak place and the place of two windows are not copies of their own.
    expect(card!.copies).toBe(2)
  })

  it('does not take windows far apart on one large picture for copies', () => {
    // A 400 px window on a picture and 150 px windows in its two corners, each a different place for a small window.
    const [card] = cardsFromHits([
      ...around(1, 0.3, 4).map(h => ({ ...h, window: { ...h.window, size: 400 } })),
      ...around(1, 0.28, 4, 300).map(h => ({ ...h, window: { x: h.window.x, y: 250, size: 150 } })),
    ])

    expect(card!.copies).toBe(1)
  })

  it('lists only the sure cards when asked (a photo of one card has no room for doubtful ones)', () => {
    const hits = [...around(1, 0.3, 8), ...around(2, 0.08, 5, 1000, 0.4)]

    expect(cardsFromHits(hits).map(card => card.cardId)).toEqual([1, 2])
    expect(cardsFromHits(hits, { onlySure: true }).map(card => card.cardId)).toEqual([1])
  })

  it('does not take a window that holds both places for two copies', () => {
    // 150 px windows in two corners of a picture that a 1,100 px window sees whole.
    const [card] = cardsFromHits([
      ...around(1, 0.3, 4).map(h => ({ ...h, window: { x: 0, y: 0, size: 150 } })),
      ...around(1, 0.28, 4).map(h => ({ ...h, window: { x: 700, y: 0, size: 150 } })),
      { cardId: 1, similarity: 0.5, margin: 0.2, window: { x: 0, y: 0, size: 1100 } },
    ])

    expect(card!.copies).toBe(1)
  })

  it('does not count windows around one card as copies', () => {
    const [card] = cardsFromHits([hit(1, 0.2, 0, 0), hit(1, 0.19, 100, 0), hit(1, 0.18, 0, 90), hit(1, 0.17, 90, 90, 160)])

    expect(card!.copies).toBe(1)
  })

  it('does not call a card sure that claims the place of a clearer one, the clearer one stays sure', () => {
    const cards = cardsFromHits([...around(1, 0.25, 8), ...around(2, 0.12, 8, 20), ...around(3, 0.2, 8, 1000)])

    expect(cards.map(card => [card.cardId, card.sure])).toEqual([[1, true], [3, true], [2, false]])
  })

  it('calls neither of two cards sure that claim a place about equally clearly', () => {
    const cards = cardsFromHits([...around(1, 0.2, 8), ...around(2, 0.18, 8, 20)])

    expect(cards.map(card => [card.cardId, card.sure])).toEqual([[1, false], [2, false]])
  })

  it('has no cards for no hits', () => {
    expect(cardsFromHits([])).toEqual([])
  })
})
