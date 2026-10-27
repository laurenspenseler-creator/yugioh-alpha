// Recognizing a card by its artwork (ADR 0041). The art of every catalog card was turned into a
// vector by a small vision model (DINOv2); a window cut out of a photo gets a vector the same way,
// and the card whose vector is closest (cosine) is the card in the window. A photograph is not a
// scan, though: lighting, mat and sleeves move all its windows the same way and make a few generic
// pictures close to everything, so both sides are first brought to a common centre (ADR 0041). This
// file is the arithmetic of that, with no model and no browser in it, so it can be tested: the
// index format, the correction, the matching with its margin, the windows to look at, and the
// merging of the hits.

/** The length of one part of a vector (DINOv2-small). */
export const ART_DIMENSION = 384
/** A vector has two parts, each a unit vector: the model's class token and the mean of its patch tokens. */
export const ART_PARTS = 2
export const ART_VECTOR = ART_DIMENSION * ART_PARTS

/**
 * The index as it is stored (`public/ai/art/index.json` + `index.bin`): `count` vectors,
 * `cardIds[i]` is the card of vector `i` (a card with alternate artworks has several vectors).
 * The binary holds `count × ART_PARTS` float32 scales and then `count × ART_VECTOR` int8 values;
 * part `p` of vector `i` is `scales[i × ART_PARTS + p] × values`, a unit vector before it was rounded.
 */
export interface ArtIndexMeta {
  version: 2
  model: string
  dimension: number
  parts: number
  count: number
  cardIds: number[]
  /** The artwork (YGOPRODeck image id) of each vector; only the tool that updates the index reads it. */
  imageIds?: number[]
  /** Which copy of its artwork each vector is (0 as it is, 1 slightly blurred, for photos that are not sharp); only the tool that updates the index reads it. */
  variants?: number[]
  /** The mean window vector of many photos of several cards (`ART_VECTOR` numbers): what a photo of few cards is corrected by (`photoCorrection`). */
  photoMean?: number[]
}

export interface ArtIndex {
  cardIds: number[]
  scales: Float32Array
  values: Int8Array
  photoMean?: Float32Array
}

export function parseArtIndex(meta: ArtIndexMeta, binary: ArrayBuffer): ArtIndex {
  if (meta.version !== 2 || meta.dimension !== ART_DIMENSION || meta.parts !== ART_PARTS) {
    throw new Error('Unknown artwork index format')
  }
  const scaleBytes = meta.count * ART_PARTS * 4
  if (binary.byteLength !== scaleBytes + meta.count * ART_VECTOR || meta.cardIds.length !== meta.count) {
    throw new Error('The artwork index is incomplete')
  }
  return {
    cardIds: meta.cardIds,
    scales: new Float32Array(binary, 0, meta.count * ART_PARTS),
    values: new Int8Array(binary, scaleBytes, meta.count * ART_VECTOR),
    photoMean: meta.photoMean?.length === ART_VECTOR ? Float32Array.from(meta.photoMean) : undefined,
  }
}

/** A vector as int8 values and the scale that gets it back; used by the tool that builds the index. */
export function quantizeVector(vector: ArrayLike<number>): { scale: number, values: Int8Array } {
  let largest = 0
  for (let i = 0; i < vector.length; i += 1) {
    largest = Math.max(largest, Math.abs(vector[i]!))
  }
  const scale = largest / 127 || 1
  const values = new Int8Array(vector.length)
  for (let i = 0; i < vector.length; i += 1) {
    values[i] = Math.round(vector[i]! / scale)
  }
  return { scale, values }
}

/** A whole vector (both parts) quantized part by part. */
export function quantizeArtVector(vector: Float32Array): { scales: number[], values: Int8Array } {
  const scales: number[] = []
  const values = new Int8Array(ART_VECTOR)
  for (let part = 0; part < ART_PARTS; part += 1) {
    const quantized = quantizeVector(vector.subarray(part * ART_DIMENSION, (part + 1) * ART_DIMENSION))
    scales.push(quantized.scale)
    values.set(quantized.values, part * ART_DIMENSION)
  }
  return { scales, values }
}

export function normalize(vector: Float32Array): Float32Array {
  let sum = 0
  for (const value of vector) {
    sum += value * value
  }
  const length = Math.sqrt(sum) || 1
  return vector.map(value => value / length)
}

/**
 * The vector of one picture from the model's output for it (`tokens` rows of `ART_DIMENSION` numbers
 * starting at `start`, the class token first, then the patches): the class token and the mean of the
 * patch tokens, each a unit vector. The index builder and the browser both use this.
 */
export function artVectorFromTokens(hidden: ArrayLike<number>, start: number, tokens: number): Float32Array {
  const vector = new Float32Array(ART_VECTOR)
  for (let d = 0; d < ART_DIMENSION; d += 1) {
    vector[d] = hidden[start + d]!
  }
  const patches = Math.max(1, tokens - 1)
  for (let token = 1; token < tokens; token += 1) {
    const row = start + token * ART_DIMENSION
    for (let d = 0; d < ART_DIMENSION; d += 1) {
      vector[ART_DIMENSION + d]! += hidden[row + d]! / patches
    }
  }
  vector.set(normalize(vector.subarray(0, ART_DIMENSION)), 0)
  vector.set(normalize(vector.subarray(ART_DIMENSION)), ART_DIMENSION)
  return vector
}

/**
 * The index with its centre moved to zero: the mean of the catalog's vectors is taken off every
 * vector (per part) and the rest is made a unit vector again. What all artworks share says nothing
 * about which one a window shows.
 */
export function centerArtIndex(index: ArtIndex): ArtIndex {
  const count = index.cardIds.length
  if (count === 0) {
    return index
  }
  const scales = new Float32Array(count * ART_PARTS)
  const values = new Int8Array(count * ART_VECTOR)
  const row = new Float32Array(ART_DIMENSION)
  for (let part = 0; part < ART_PARTS; part += 1) {
    const mean = new Float64Array(ART_DIMENSION)
    for (let i = 0; i < count; i += 1) {
      const scale = index.scales[i * ART_PARTS + part]!
      const start = partStart(i, part)
      for (let d = 0; d < ART_DIMENSION; d += 1) {
        mean[d]! += index.values[start + d]! * scale
      }
    }
    for (let i = 0; i < count; i += 1) {
      const scale = index.scales[i * ART_PARTS + part]!
      const start = partStart(i, part)
      for (let d = 0; d < ART_DIMENSION; d += 1) {
        row[d] = index.values[start + d]! * scale - mean[d]! / count
      }
      const quantized = quantizeVector(normalize(row))
      scales[i * ART_PARTS + part] = quantized.scale
      values.set(quantized.values, start)
    }
  }
  return { cardIds: index.cardIds, scales, values, photoMean: index.photoMean }
}

/** Where part `part` of vector `vectorIndex` starts in `ArtIndex.values`. */
function partStart(vectorIndex: number, part: number): number {
  return vectorIndex * ART_VECTOR + part * ART_DIMENSION
}

/** How many of the strongest shared directions of a photo's windows are taken off them. */
export const ART_DROPPED_DIRECTIONS = 3
/** Fewer windows than this cannot tell the photo's own shift from its cards. */
const MIN_WINDOWS_TO_CORRECT = 4

/**
 * Brings the vectors of a photo's windows to the catalog's side. Every window of a photo shares
 * what the photo is (light, mat, sleeves, the angle it was taken at); that is the mean of the
 * windows, and the few directions in which they vary most are mostly the same effects. Both are
 * taken off, per part, and each part is made a unit vector again. Only the shape of the windows
 * of one photo is used: nothing is known about which cards it shows.
 */
export function correctForPhoto(vectors: readonly Float32Array[], dropped = ART_DROPPED_DIRECTIONS, photoMean?: ArrayLike<number>): Float32Array[] {
  const correct = photoCorrection(vectors, dropped, photoMean)
  return vectors.map(vector => correct(vector))
}

/** The mean of vectors of the same length; the tool that estimates `photoMean` of the index averages these over many photos. */
export function meanVector(vectors: readonly Float32Array[]): Float32Array {
  const mean = new Float32Array(vectors[0]?.length ?? 0)
  for (const vector of vectors) {
    for (let d = 0; d < mean.length; d += 1) {
      mean[d]! += vector[d]! / vectors.length
    }
  }
  return mean
}

/**
 * The windows of a photo of several cards differ in many directions; those of a photo of one card
 * (or two) mostly in one, because most of them show that card at some size. When this share of the
 * windows' variance lies along their strongest direction, the photo's own mean is the card, and
 * taking it off takes the card off: the mean of many photos (`photoMean` of the index) is used
 * instead, and at this share and above only that one.
 */
const FEW_CARDS_SHARE_FROM = 0.22
const FEW_CARDS_SHARE_TO = 0.32

/** The share of the variance of centred rows that lies along their strongest direction. */
function strongestShare(rows: readonly Float32Array[]): number {
  const direction = mainDirections(rows, 1)[0]
  if (!direction || rows.length === 0) {
    return 0
  }
  let along = 0
  let total = 0
  for (const row of rows) {
    let dot = 0
    for (let d = 0; d < ART_DIMENSION; d += 1) {
      dot += row[d]! * direction[d]!
      total += row[d]! * row[d]!
    }
    along += dot * dot
  }
  return total === 0 ? 0 : along / total
}

/**
 * What `correctForPhoto` takes off, learned from a photo's windows once, to be applied to those
 * windows and to windows that are looked at later (a closer look at a place that matched).
 * `photoMean` is the mean window vector of many photos (both parts, as the model gives them), used
 * for a photo of few cards instead of the photo's own mean (see `FEW_CARDS_SHARE_FROM`).
 */
export function photoCorrection(vectors: readonly Float32Array[], dropped = ART_DROPPED_DIRECTIONS, photoMean?: ArrayLike<number>): PhotoCorrection {
  const count = vectors.length
  if (count < MIN_WINDOWS_TO_CORRECT) {
    return Object.assign((vector: Float32Array) => joinParts(part => normalize(vector.subarray(part * ART_DIMENSION, (part + 1) * ART_DIMENSION))), { own: 1 })
  }
  const rowsOfPart: Float32Array[][] = []
  const means: Float64Array[] = []
  for (let part = 0; part < ART_PARTS; part += 1) {
    const rows = vectors.map(vector => vector.slice(part * ART_DIMENSION, (part + 1) * ART_DIMENSION))
    const mean = new Float64Array(ART_DIMENSION)
    for (const row of rows) {
      for (let d = 0; d < ART_DIMENSION; d += 1) {
        mean[d]! += row[d]! / count
      }
    }
    for (const row of rows) {
      for (let d = 0; d < ART_DIMENSION; d += 1) {
        row[d]! -= mean[d]!
      }
    }
    means.push(mean)
    rowsOfPart.push(rows)
  }

  // How much of the photo's own mean is trusted: all of it for many cards, none for few.
  const share = photoMean ? strongestShare(rowsOfPart[0]!) : 0
  const own = Math.min(1, Math.max(0, (FEW_CARDS_SHARE_TO - share) / (FEW_CARDS_SHARE_TO - FEW_CARDS_SHARE_FROM)))
  const directionsOfPart: Float64Array[][] = []
  for (let part = 0; part < ART_PARTS; part += 1) {
    if (own < 1) {
      for (let d = 0; d < ART_DIMENSION; d += 1) {
        means[part]![d] = own * means[part]![d]! + (1 - own) * photoMean![part * ART_DIMENSION + d]!
      }
    }
    // The directions come from the windows after the mean is off; each window then loses what lies along them
    // (not for a photo of few cards: that direction is the card).
    directionsOfPart.push(own < 1 ? [] : mainDirections(rowsOfPart[part]!, Math.min(dropped, Math.floor(count / 8))))
  }
  return Object.assign((vector: Float32Array) => joinParts((part) => {
    const row = vector.slice(part * ART_DIMENSION, (part + 1) * ART_DIMENSION)
    for (let d = 0; d < ART_DIMENSION; d += 1) {
      row[d]! -= means[part]![d]!
    }
    for (const direction of directionsOfPart[part]!) {
      let shared = 0
      for (let d = 0; d < ART_DIMENSION; d += 1) {
        shared += row[d]! * direction[d]!
      }
      for (let d = 0; d < ART_DIMENSION; d += 1) {
        row[d]! -= shared * direction[d]!
      }
    }
    return normalize(row)
  }), { own })
}

/** A correction learned from a photo; `own` is how much of the photo's own mean it uses (1 for a photo of many cards, 0 for one of few). */
export type PhotoCorrection = ((vector: Float32Array) => Float32Array) & { own: number }

function joinParts(partOf: (part: number) => Float32Array): Float32Array {
  const out = new Float32Array(ART_VECTOR)
  for (let part = 0; part < ART_PARTS; part += 1) {
    out.set(partOf(part), part * ART_DIMENSION)
  }
  return out
}

/** The `wanted` directions the rows vary most along (power iteration; the rows are already centred). */
function mainDirections(rows: readonly Float32Array[], wanted: number): Float64Array[] {
  const directions: Float64Array[] = []
  for (let found = 0; found < wanted; found += 1) {
    // A fixed start keeps the result the same on every run.
    let direction = Float64Array.from({ length: ART_DIMENSION }, (_, d) => Math.sin(d * 12.9898 + found * 78.233))
    for (let step = 0; step < 40; step += 1) {
      const next = new Float64Array(ART_DIMENSION)
      for (const row of rows) {
        let along = 0
        for (let d = 0; d < ART_DIMENSION; d += 1) {
          along += row[d]! * direction[d]!
        }
        for (let d = 0; d < ART_DIMENSION; d += 1) {
          next[d]! += along * row[d]!
        }
      }
      for (const earlier of directions) {
        let along = 0
        for (let d = 0; d < ART_DIMENSION; d += 1) {
          along += next[d]! * earlier[d]!
        }
        for (let d = 0; d < ART_DIMENSION; d += 1) {
          next[d]! -= along * earlier[d]!
        }
      }
      let length = 0
      for (let d = 0; d < ART_DIMENSION; d += 1) {
        length += next[d]! * next[d]!
      }
      length = Math.sqrt(length) || 1
      direction = next.map(value => value / length)
    }
    directions.push(direction)
  }
  return directions
}

export interface ArtMatch {
  cardId: number
  /** Mean cosine similarity of the two parts with the card's artwork (both centred), 0 for anything and up to 1. */
  similarity: number
  /** How much closer this card is than the next best other card: tells a certain match from a lucky one. */
  margin: number
}

/**
 * How close `vector` (both parts unit vectors, see `correctForPhoto`) is to every vector of the
 * index (`centerArtIndex`ed): the mean of the cosines of the two parts. The browser does the same
 * on the graphics card when it has one (`app/workers/art-gpu.ts`); this is the version for the processor.
 */
export function similarities(index: ArtIndex, vector: Float32Array): Float32Array {
  const { values, scales } = index
  const count = index.cardIds.length
  const out = new Float32Array(count)
  for (let i = 0; i < count; i += 1) {
    let similarity = 0
    for (let part = 0; part < ART_PARTS; part += 1) {
      const start = partStart(i, part)
      const base = part * ART_DIMENSION
      // Four sums side by side: this loop runs 11 million times per window, and it is about 30 % faster so.
      let a = 0
      let b = 0
      let c = 0
      let e = 0
      for (let d = 0; d < ART_DIMENSION; d += 4) {
        a += values[start + d]! * vector[base + d]!
        b += values[start + d + 1]! * vector[base + d + 1]!
        c += values[start + d + 2]! * vector[base + d + 2]!
        e += values[start + d + 3]! * vector[base + d + 3]!
      }
      similarity += (a + b + c + e) * scales[i * ART_PARTS + part]!
    }
    out[i] = similarity / ART_PARTS
  }
  return out
}

/**
 * The card with the highest of `similarity[start ...]` (one value per index vector, in the order of
 * `cardIds`), and how far ahead of the next best other card it is.
 */
export function matchFromSimilarities(cardIds: readonly number[], similarity: ArrayLike<number>, start = 0): ArtMatch | null {
  let bestCard = -1
  let bestSimilarity = -Infinity
  let secondSimilarity = -Infinity
  for (let i = 0; i < cardIds.length; i += 1) {
    const value = similarity[start + i]!
    if (value > bestSimilarity) {
      // A second vector of the same card moves nothing down: "second" is the best of the other cards.
      if (cardIds[i] !== bestCard) {
        secondSimilarity = bestSimilarity
      }
      bestCard = cardIds[i]!
      bestSimilarity = value
    }
    else if (cardIds[i] !== bestCard && value > secondSimilarity) {
      secondSimilarity = value
    }
  }
  if (bestCard < 0) {
    return null
  }
  return { cardId: bestCard, similarity: bestSimilarity, margin: secondSimilarity === -Infinity ? bestSimilarity : bestSimilarity - secondSimilarity }
}

/**
 * The card whose artwork is closest to `vector` and how far ahead of the next card it is.
 * `index` must be centred (`centerArtIndex`).
 */
export function bestMatch(index: ArtIndex, vector: Float32Array): ArtMatch | null {
  return matchFromSimilarities(index.cardIds, similarities(index, vector))
}

export interface ArtWindow {
  x: number
  y: number
  size: number
}

/** Square windows of each size over a picture, `stride` of a window apart (1 = side by side, 0.5 = half overlapping). */
export function artWindows(width: number, height: number, sizes: readonly number[], stride: number): ArtWindow[] {
  const windows: ArtWindow[] = []
  for (const size of sizes) {
    if (size > width || size > height) {
      continue
    }
    const step = Math.max(8, Math.round(size * stride))
    // The last window of a row or column ends at the edge instead of being cut off.
    const xs = positions(width, size, step)
    const ys = positions(height, size, step)
    for (const y of ys) {
      for (const x of xs) {
        windows.push({ x, y, size })
      }
    }
  }
  return windows
}

function positions(length: number, size: number, step: number): number[] {
  const out: number[] = []
  for (let at = 0; at + size <= length; at += step) {
    out.push(at)
  }
  const last = length - size
  if (out.length === 0 || (out.at(-1)! < last && last - out.at(-1)! > step / 3)) {
    out.push(last)
  }
  return out
}

export interface ArtHit extends ArtMatch {
  window: ArtWindow
}

/**
 * A window never sits exactly on the artwork: a closer look at a place that matched moves it a
 * little in each direction and zooms it, and the best of these is the match for the card (ADR 0041).
 */
export const ART_REFINE_SHIFTS = [-0.2, 0, 0.2] as const
export const ART_REFINE_ZOOMS = [0.85, 1, 1.2] as const
/** Places whose card is at least this far ahead of the others in the first pass get a closer look. */
export const ART_REFINE_MIN_MARGIN = 0.05
/** And no more than this many places per photo, the clearest first. */
export const ART_REFINE_MAX_PLACES = 15

/** The windows of the closer look at `window`: shifted by fractions of its size and zoomed, inside the picture, without the window itself. */
export function refinementWindows(
  window: ArtWindow,
  width: number,
  height: number,
  shifts: readonly number[] = ART_REFINE_SHIFTS,
  zooms: readonly number[] = ART_REFINE_ZOOMS,
): ArtWindow[] {
  const windows: ArtWindow[] = []
  for (const zoom of zooms) {
    const size = Math.round(window.size * zoom)
    for (const dy of shifts) {
      for (const dx of shifts) {
        const x = Math.round(window.x + dx * window.size - (size - window.size) / 2)
        const y = Math.round(window.y + dy * window.size - (size - window.size) / 2)
        if (x >= 0 && y >= 0 && x + size <= width && y + size <= height && !(x === window.x && y === window.y && size === window.size)) {
          windows.push({ x, y, size })
        }
      }
    }
  }
  return windows
}

/**
 * Windows within this many window widths of each other (centre to centre) look at the same place:
 * a card is matched by windows up to half a window off.
 */
const SAME_PLACE_DISTANCE = 0.9
/** At most this many places of one card get a closer look. */
const REFINE_PLACES_PER_CARD = 3

function centerDistance(a: ArtWindow, b: ArtWindow): number {
  return Math.hypot(a.x + a.size / 2 - (b.x + b.size / 2), a.y + a.size / 2 - (b.y + b.size / 2)) / Math.max(a.size, b.size)
}

export interface ArtPlace {
  /** The hit furthest ahead of the others at this place. */
  best: ArtHit
  /** How many windows hit the card here. */
  support: number
}

/** The separate places on the photo a card's hits lie at, the clearest first: a hit joins the first place whose best hit is near it. */
export function artPlaces(hits: readonly ArtHit[]): ArtPlace[] {
  const places: ArtPlace[] = []
  for (const hit of [...hits].sort((a, b) => b.margin - a.margin)) {
    const place = places.find(known => centerDistance(known.best.window, hit.window) < SAME_PLACE_DISTANCE)
    if (place) {
      place.support += 1
    }
    else {
      places.push({ best: hit, support: 1 })
    }
  }
  return places
}

/** The places that are clear enough to be worth a closer look (up to three per card), the clearest first. */
export function refinementCandidates(hits: readonly ArtHit[], minMargin = ART_REFINE_MIN_MARGIN, limit = ART_REFINE_MAX_PLACES): ArtHit[] {
  const byCard = new Map<number, ArtHit[]>()
  for (const hit of hits) {
    if (hit.margin >= minMargin) {
      byCard.set(hit.cardId, [...(byCard.get(hit.cardId) ?? []), hit])
    }
  }
  const places = [...byCard.values()].flatMap(list => artPlaces(list).slice(0, REFINE_PLACES_PER_CARD).map(place => place.best))
  return places.sort((a, b) => b.margin - a.margin).slice(0, limit)
}

/** A window counts as support for its card when it is this clear and about this close (centred cosine). */
export const ART_SUPPORT_MARGIN = 0.05
export const ART_SUPPORT_SIMILARITY = 0.3

/** What a card needs to be listed: its best window this far ahead and this close, matched by this many windows (a card on a photo is matched from many sides, a lucky match by one or two windows). */
export const ART_MIN_MARGIN = 0.07
export const ART_MIN_SIMILARITY = 0.35
export const ART_MIN_SUPPORT = 4
/** And to be called sure. */
export const ART_SURE_MARGIN = 0.1
export const ART_SURE_SIMILARITY = 0.4
export const ART_SURE_SUPPORT = 6
/**
 * A further place counts as another copy of a card when it is as good as a card of its own would
 * have to be: at least this share as clear as the best place, clear enough to be sure, shown by
 * this many windows (a lucky window of a look-alike elsewhere is no copy), and a card's width away
 * from the places already counted (windows far apart on one large picture are one card).
 */
const FURTHER_COPY_SHARE = 0.6
const FURTHER_COPY_SUPPORT = 3
const FURTHER_COPY_DISTANCE = 1.2

export interface ArtCard {
  cardId: number
  /** The similarity of its best hit. */
  similarity: number
  /** The margin of its best hit. */
  margin: number
  /** How many separate places on the photo show it. */
  copies: number
  /** How many windows of the photo matched it. */
  support: number
  sure: boolean
}

/**
 * Two cards whose best windows lie this close (centre to centre, in window widths) claim the same
 * place on the photo; a place holds one card.
 */
const SAME_CLAIM_DISTANCE = 0.5
/** The one that is clearer must be this much clearer, or neither of the two is sure. */
const CLAIM_GAP = 0.05

/**
 * The cards a list of window hits stands for: windows that are too weak or too close to another
 * card are not counted, a card needs enough of the others (`ART_MIN_SUPPORT`), and its best hit
 * (the one furthest ahead) is its strength. Places far enough apart with the same card are copies.
 * A place holds one card: when a second card claims the place of a clearer one it is not sure (a
 * look-alike or a generic picture), and when the two are about equally clear neither is. With
 * `onlySure` only the sure cards are returned: a photo of one card or two has no room for the
 * doubtful ones that the frame, the text and the table of a card give.
 */
export function cardsFromHits(hits: readonly ArtHit[], options: { onlySure?: boolean, supportScale?: number } = {}): ArtCard[] {
  // A sparser look at the photo gives every card fewer windows: the support it needs shrinks with it.
  const scale = options.supportScale ?? 1
  const minSupport = Math.max(2, Math.round(ART_MIN_SUPPORT * scale))
  const sureSupport = Math.max(minSupport, Math.round(ART_SURE_SUPPORT * scale))
  const byCard = new Map<number, ArtHit[]>()
  for (const hit of hits) {
    if (hit.similarity >= ART_SUPPORT_SIMILARITY && hit.margin >= ART_SUPPORT_MARGIN) {
      byCard.set(hit.cardId, [...(byCard.get(hit.cardId) ?? []), hit])
    }
  }

  const found: Array<{ card: ArtCard, window: ArtWindow }> = []
  for (const [cardId, list] of byCard) {
    const places = artPlaces(list)
    const best = places[0]!.best
    if (best.margin < ART_MIN_MARGIN || best.similarity < ART_MIN_SIMILARITY || list.length < minSupport) {
      continue
    }
    const copies = [places[0]!]
    for (const place of places.slice(1)) {
      if (
        place.support >= FURTHER_COPY_SUPPORT
        && place.best.margin >= Math.max(ART_SURE_MARGIN, best.margin * FURTHER_COPY_SHARE)
        && copies.every(copy => centerDistance(copy.best.window, place.best.window) >= FURTHER_COPY_DISTANCE && !oneWindowCoversBoth(list, copy.best.window, place.best.window))
      ) {
        copies.push(place)
      }
    }
    found.push({
      window: best.window,
      card: {
        cardId,
        similarity: best.similarity,
        margin: best.margin,
        copies: copies.length,
        support: list.length,
        sure: best.margin >= ART_SURE_MARGIN && best.similarity >= ART_SURE_SIMILARITY && list.length >= sureSupport,
      },
    })
  }

  found.sort((a, b) => b.card.margin - a.card.margin)
  for (const [i, clearer] of found.entries()) {
    for (const other of found.slice(i + 1)) {
      if (centerDistance(clearer.window, other.window) < SAME_CLAIM_DISTANCE) {
        other.card.sure = false
        if (clearer.card.margin - other.card.margin < CLAIM_GAP) {
          clearer.card.sure = false
        }
      }
    }
  }
  const cards = found.map(entry => entry.card)
  return options.onlySure ? cards.filter(card => card.sure) : cards
}

/** Whether a hit of the card has a window that holds the centres of both windows well inside it (one picture seen from two corners, not two cards). */
function oneWindowCoversBoth(hits: readonly ArtHit[], a: ArtWindow, b: ArtWindow): boolean {
  const apart = Math.hypot(a.x + a.size / 2 - (b.x + b.size / 2), a.y + a.size / 2 - (b.y + b.size / 2))
  return hits.some((hit) => {
    const w = hit.window
    const inside = (c: ArtWindow) => c.x + c.size / 2 > w.x && c.x + c.size / 2 < w.x + w.size && c.y + c.size / 2 > w.y && c.y + c.size / 2 < w.y + w.size
    return w.size >= COVERS_BOTH_RATIO * apart && inside(a) && inside(b)
  })
}
const COVERS_BOTH_RATIO = 1.5
