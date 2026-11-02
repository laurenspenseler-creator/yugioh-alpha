// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { ALIGNED_SHIFTS, ALIGNED_SIZES, alignedWindows, findArtBoxes, PATCH_SIZE } from '../../shared/card-art-boxes'
import type { PatchMap } from '../../shared/card-art-boxes'
import { alignedCorrection, ART_DIMENSION, ART_VECTOR, boxVector, cardsFromBoxes, HUB_SURE_MARGIN, HUB_SURE_SIMILARITY } from '../../shared/card-art'

const DIMENSION = 4
const TABLE = [1, 0, 0, 0]
const FRAME = [0, 1, 0, 0]
const ART = [0, 0, 1, 0]

/** A grid of patches: the table everywhere, and a card (frame with an artwork in it) at each of `cards` (artwork box in patches, frame one patch wider each way). */
function mapWith(cards: Array<[number, number, number, number]>, size = 24): PatchMap {
  const features = new Float32Array(size * size * DIMENSION)
  const luminance = new Float32Array(size * size)
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let kind = TABLE
      let light = 200
      for (const [x0, y0, x1, y1] of cards) {
        if (x >= x0 - 1 && x < x1 + 1 && y >= y0 - 1 && y < y1 + 1) {
          kind = x >= x0 && x < x1 && y >= y0 && y < y1 ? ART : FRAME
          light = 80
        }
      }
      // A little of the table in every patch, so no two are exactly alike.
      kind.forEach((value, d) => { features[(y * size + x) * DIMENSION + d] = value + (((x * 7 + y * 13) % 5) - 2) * 0.01 })
      luminance[y * size + x] = light
    }
  }
  return { features, dimension: DIMENSION, gridCols: size, gridRows: size, cols: size, rows: size, luminance }
}

describe('findArtBoxes', () => {
  it('finds the box of every artwork, one per card, also where cards touch', () => {
    // The first two share a border column: their frames touch.
    const map = mapWith([[3, 3, 11, 11], [13, 3, 21, 11], [3, 14, 11, 22]])
    const boxes = findArtBoxes(map, ART)

    expect(boxes).toEqual([
      { x0: 3, y0: 3, x1: 11, y1: 11 },
      { x0: 13, y0: 3, x1: 21, y1: 11 },
      { x0: 3, y0: 14, x1: 11, y1: 22 },
    ])
  })

  it('finds nothing where there is no table to tell the cards from', () => {
    expect(findArtBoxes(mapWith([]), ART)).toEqual([])
  })

  it('leaves out regions that are too small or not square', () => {
    // A 3 x 3 speck and a 12 x 5 strip: neither is an artwork.
    const map = mapWith([[3, 3, 6, 6], [8, 14, 20, 19], [3, 8, 11, 12]])
    const boxes = findArtBoxes(map, ART)

    expect(boxes.some(box => box.x0 === 3 && box.y0 === 3)).toBe(false)
    expect(boxes.some(box => box.x0 === 8 && box.y0 === 14)).toBe(false)
  })

  it('takes a prototype of another size for no prototype', () => {
    expect(findArtBoxes(mapWith([[3, 3, 11, 11]]), [1, 0])).toEqual([])
  })
})

describe('alignedWindows', () => {
  it('puts a few sizes and shifts of windows on every box, a little larger than the box', () => {
    const windows = alignedWindows([{ x0: 10, y0: 10, x1: 20, y1: 20 }], 600, 600)

    expect(windows).toHaveLength(ALIGNED_SIZES.length * ALIGNED_SHIFTS.length)
    const first = windows[0]!
    expect(first.size).toBe(10 * PATCH_SIZE)
    // Centred on the box.
    expect(first.x + first.size / 2).toBe(15 * PATCH_SIZE)
    expect(first.y + first.size / 2).toBe(15 * PATCH_SIZE)
    expect(windows.some(window => window.size === Math.round(10 * PATCH_SIZE * 1.15))).toBe(true)
    expect(windows.every(window => window.box === 0)).toBe(true)
  })

  it('keeps every window inside the picture', () => {
    const windows = alignedWindows([{ x0: 0, y0: 0, x1: 10, y1: 10 }, { x0: 40, y0: 55, x1: 50, y1: 60 }], 700, 800)

    for (const window of windows) {
      expect(window.x).toBeGreaterThanOrEqual(0)
      expect(window.y).toBeGreaterThanOrEqual(0)
      expect(window.x + window.size).toBeLessThanOrEqual(700)
      expect(window.y + window.size).toBeLessThanOrEqual(800)
    }
  })
})

describe('alignedCorrection', () => {
  it('takes the mean of the windows off and leaves each part a unit vector', () => {
    const a = new Float32Array(ART_VECTOR)
    const b = new Float32Array(ART_VECTOR)
    for (let part = 0; part < 2; part += 1) {
      a[part * ART_DIMENSION] = 2
      a[part * ART_DIMENSION + 1] = 1
      b[part * ART_DIMENSION] = 2
      b[part * ART_DIMENSION + 1] = -1
    }
    const [x, y] = alignedCorrection([a, b])

    // What both have (the first dimension) is gone, what differs is what is left.
    for (const vector of [x!, y!]) {
      for (let part = 0; part < 2; part += 1) {
        const length = Math.hypot(...Array.from(vector.slice(part * ART_DIMENSION, (part + 1) * ART_DIMENSION)))
        expect(length).toBeCloseTo(1, 5)
        expect(vector[part * ART_DIMENSION]).toBeCloseTo(0, 5)
      }
    }
    expect(x![1]).toBeGreaterThan(0)
    expect(y![1]).toBeLessThan(0)
  })

  /** A vector with a 1 at `at` in both parts. */
  const unitAt = (at: number) => {
    const vector = new Float32Array(ART_VECTOR)
    vector[at] = 1
    vector[ART_DIMENSION + at] = 1
    return vector
  }

  it('keeps the photo\'s own mean for windows of many different cards, whatever mean is given for few', () => {
    const windows = Array.from({ length: 8 }, (_, at) => unitAt(at))
    const mean = unitAt(20)

    expect(alignedCorrection(windows, mean)).toEqual(alignedCorrection(windows))
  })

  it('takes the mean of many photos off instead for windows that all show the same card', () => {
    // Twelve times the same card: the photo's own mean is that card, and nothing would be left of it.
    const windows = Array.from({ length: 12 }, () => unitAt(0))
    const corrected = alignedCorrection(windows, unitAt(1))

    for (const vector of corrected) {
      expect(vector[0]).toBeCloseTo(Math.SQRT1_2, 5)
      expect(vector[1]).toBeCloseTo(-Math.SQRT1_2, 5)
      expect(vector[ART_DIMENSION]).toBeCloseTo(Math.SQRT1_2, 5)
    }
  })
})

describe('cardsFromBoxes', () => {
  const box = (cardId: number, similarity: number, margin: number, support = 5) => ({ cardId, similarity, margin, support })

  it('calls a card sure on a clear box and counts a box for each copy', () => {
    const cards = cardsFromBoxes([box(1, 0.5, 0.2), box(1, 0.45, 0.1), box(1, 0.4, 0.08), box(2, 0.6, 0.3)])

    expect(cards.find(card => card.cardId === 1)).toMatchObject({ sure: true, copies: 3, similarity: 0.5, margin: 0.2 })
    expect(cards.find(card => card.cardId === 2)).toMatchObject({ sure: true, copies: 1 })
  })

  it('lists a card that is only close as doubtful, and leaves out one that is not even that', () => {
    const cards = cardsFromBoxes([box(1, 0.37, 0.04), box(2, 0.3, 0.2), box(3, 0.5, 0.01)])

    expect(cards.map(card => [card.cardId, card.sure])).toEqual([[1, false]])
  })

  it('asks a hub for the larger lead and closeness', () => {
    const hubs = new Set([7])
    const weak = cardsFromBoxes([box(7, 0.45, 0.08)], { hubs })
    const strong = cardsFromBoxes([box(7, HUB_SURE_SIMILARITY, HUB_SURE_MARGIN)], { hubs })

    expect(weak.find(card => card.cardId === 7)?.sure).toBe(false)
    expect(strong.find(card => card.cardId === 7)?.sure).toBe(true)
  })

  it('puts the clearest first', () => {
    const cards = cardsFromBoxes([box(1, 0.45, 0.07), box(2, 0.6, 0.3)])

    expect(cards.map(card => card.cardId)).toEqual([2, 1])
  })

  /** A box that looks like `alike` of the unit vector along the first axis (and otherwise along the second). */
  const looking = (cardId: number, similarity: number, margin: number, alike: number) => ({ ...box(cardId, similarity, margin), vector: [alike, Math.sqrt(1 - alike * alike), 0, 0] })

  it('counts a box that looks like a box that is sure as one more copy of that card, whatever it matched itself', () => {
    // The second matched a look-alike a hair ahead; it looks like the first as copies do.
    const cards = cardsFromBoxes([looking(1, 0.5, 0.2, 1), looking(2, 0.4, 0.04, 0.93), looking(3, 0.45, 0.08, 0.6)])

    expect(cards.find(card => card.cardId === 1)).toMatchObject({ sure: true, copies: 2 })
    expect(cards.find(card => card.cardId === 2)).toBeUndefined()
    expect(cards.find(card => card.cardId === 3)).toMatchObject({ copies: 1 })
  })

  it('leaves a box that is sure for another card with that card, however alike it looks', () => {
    const cards = cardsFromBoxes([looking(1, 0.5, 0.2, 1), looking(2, 0.5, 0.2, 0.95)])

    expect(cards.map(card => [card.cardId, card.copies])).toEqual([[1, 1], [2, 1]])
  })

  it('does not count a box as a copy of a card that is only doubtful', () => {
    const cards = cardsFromBoxes([looking(1, 0.37, 0.04, 1), looking(2, 0.37, 0.035, 0.95)])

    expect(cards.map(card => [card.cardId, card.sure, card.copies])).toEqual([[1, false, 1], [2, false, 1]])
  })
})

describe('boxVector', () => {
  it('is the mean of the windows\' patch parts, as a unit vector', () => {
    const along = (axis: number) => {
      const vector = new Float32Array(ART_VECTOR)
      vector[ART_DIMENSION + axis] = 1
      vector[axis] = 1
      return vector
    }
    const vector = boxVector([along(0), along(0), along(1)])

    expect(Math.hypot(...Array.from(vector))).toBeCloseTo(1, 5)
    expect(vector[0]! / vector[1]!).toBeCloseTo(2, 5)
    expect(vector).toHaveLength(ART_DIMENSION)
  })
})
