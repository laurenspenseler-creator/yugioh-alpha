// Recognizing a card by its artwork (ADR 0041). The art of every catalog card was turned into a
// vector by a small vision model (DINOv2); a window cut out of a photo gets a vector the same way,
// and the card whose vector is closest (cosine) is the card in the window. A photograph is not a
// scan, though: lighting, mat and sleeves move all its windows the same way and make a few generic
// pictures close to everything, so both sides are first brought to a common centre (ADR 0041). This
// file is the arithmetic of that, with no model and no browser in it, so it can be tested: the
// index format, the correction, the matching with its margin, the windows to look at, and the
// merging of the hits.
import { ART_COLOR_DIMENSION, colorSimilarity, dequantizeColor } from './card-color'

/** The length of one part of a vector (DINOv2-small). */
export const ART_DIMENSION = 384
/** A vector has two parts, each a unit vector: the model's class token and the mean of its patch tokens. */
export const ART_PARTS = 2
export const ART_VECTOR = ART_DIMENSION * ART_PARTS
/** The size of the map of `adapter.bin` (`shared/card-art-adapter.ts`): `ART_VECTOR × ART_VECTOR` numbers, row by row (row `a` makes number `a` of the new vector). */
export const ART_ADAPTER_SIZE = ART_VECTOR * ART_VECTOR

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
  /** The colour of every vector's artwork is in `colors.bin` (`ART_COLOR_DIMENSION` int8 numbers each, see shared/card-color.ts), and `colorMean` is their mean. */
  colors?: number
  colorMean?: number[]
  /**
   * Cards that win windows on photo after photo without being on them (generic pictures that match a
   * sleeve, a shadow or the table): they are only called sure with overwhelming evidence (`cardsFromHits`).
   * Estimated from photos with a known list of cards, not from the artworks.
   */
  hubs?: number[]
  /** The mean unit token of the patches inside many catalog artworks (ART_DIMENSION numbers): what findArtBoxes in shared/card-art-boxes.ts takes for the picture of a card. */
  artPrototype?: number[]
}

/** The colours of the artworks, one per vector of the index, and the first vector of each card. */
export interface ArtColors {
  values: Int8Array
  mean: Float32Array
  rowOfCard: Map<number, number>
}

export interface ArtIndex {
  cardIds: number[]
  scales: Float32Array
  values: Int8Array
  photoMean?: Float32Array
  colors?: ArtColors
  hubs?: ReadonlySet<number>
  artPrototype?: Float32Array
  /** What a photo does to the vector of an artwork, learned (`shared/card-art-adapter.ts`): the vectors of the windows on the artworks are moved by it. */
  adapter?: Float32Array
}

/**
 * `colors` is the contents of `colors.bin`; an index that has none (or that is not told about them) works without colour.
 * `adapter` is the contents of `adapter.bin`, ignored when it is not of the right size.
 */
export function parseArtIndex(meta: ArtIndexMeta, binary: ArrayBuffer, colors?: ArrayBuffer, adapter?: ArrayBuffer): ArtIndex {
  if (meta.version !== 2 || meta.dimension !== ART_DIMENSION || meta.parts !== ART_PARTS) {
    throw new Error('Unknown artwork index format')
  }
  const scaleBytes = meta.count * ART_PARTS * 4
  if (binary.byteLength !== scaleBytes + meta.count * ART_VECTOR || meta.cardIds.length !== meta.count) {
    throw new Error('The artwork index is incomplete')
  }
  let artColors: ArtColors | undefined
  if (colors && meta.colors === ART_COLOR_DIMENSION && meta.colorMean?.length === ART_COLOR_DIMENSION) {
    if (colors.byteLength !== meta.count * ART_COLOR_DIMENSION) {
      throw new Error('The artwork colours are incomplete')
    }
    const rowOfCard = new Map<number, number>()
    meta.cardIds.forEach((cardId, row) => {
      if (!rowOfCard.has(cardId)) {
        rowOfCard.set(cardId, row)
      }
    })
    artColors = { values: new Int8Array(colors), mean: Float32Array.from(meta.colorMean), rowOfCard }
  }
  return {
    cardIds: meta.cardIds,
    scales: new Float32Array(binary, 0, meta.count * ART_PARTS),
    values: new Int8Array(binary, scaleBytes, meta.count * ART_VECTOR),
    photoMean: meta.photoMean?.length === ART_VECTOR ? Float32Array.from(meta.photoMean) : undefined,
    colors: artColors,
    hubs: meta.hubs ? new Set(meta.hubs) : undefined,
    artPrototype: meta.artPrototype?.length === ART_DIMENSION ? Float32Array.from(meta.artPrototype) : undefined,
    adapter: adapter?.byteLength === ART_ADAPTER_SIZE * 4 ? new Float32Array(adapter) : undefined,
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
  return { cardIds: index.cardIds, scales, values, photoMean: index.photoMean, colors: index.colors, hubs: index.hubs, artPrototype: index.artPrototype, adapter: index.adapter }
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

export interface ArtRunnerUp {
  cardId: number
  similarity: number
}

export interface ArtMatch {
  cardId: number
  /** Mean cosine similarity of the two parts with the card's artwork (both centred), 0 for anything and up to 1. */
  similarity: number
  /** How much closer this card is than the next best other card: tells a certain match from a lucky one. */
  margin: number
  /** The next best other cards, closest first: on a real photo the right card is often second, a hair behind a look-alike. */
  runnersUp?: ArtRunnerUp[]
}

/** How many other cards a match remembers. */
export const ART_RUNNERS_UP = 3

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
 * `cardIds`), and how far ahead of the next best other card it is. `others` is how many other cards
 * are remembered (the colour needs more of them than the decision does).
 */
export function matchFromSimilarities(cardIds: readonly number[], similarity: ArrayLike<number>, start = 0, others = ART_RUNNERS_UP): ArtMatch | null {
  // The closest cards, one entry per card (a second vector of the same card moves nothing down), closest first.
  const top: ArtRunnerUp[] = []
  for (let i = 0; i < cardIds.length; i += 1) {
    const value = similarity[start + i]!
    if (top.length > others && value <= top[others]!.similarity) {
      continue
    }
    const card = cardIds[i]!
    const known = top.findIndex(entry => entry.cardId === card)
    if (known >= 0) {
      if (value <= top[known]!.similarity) {
        continue
      }
      top.splice(known, 1)
    }
    const at = top.findIndex(entry => value > entry.similarity)
    top.splice(at < 0 ? top.length : at, 0, { cardId: card, similarity: value })
    if (top.length > others + 1) {
      top.pop()
    }
  }
  const best = top[0]
  if (!best) {
    return null
  }
  return { cardId: best.cardId, similarity: best.similarity, margin: top.length > 1 ? best.similarity - top[1]!.similarity : best.similarity, runnersUp: top.slice(1) }
}

/**
 * The card whose artwork is closest to `vector` and how far ahead of the next card it is.
 * `index` must be centred (`centerArtIndex`).
 */
export function bestMatch(index: ArtIndex, vector: Float32Array, others = ART_RUNNERS_UP): ArtMatch | null {
  return matchFromSimilarities(index.cardIds, similarities(index, vector), 0, others)
}

/** The other cards a match is asked to remember when the colour is to choose among them. */
export const ART_COLOR_CANDIDATES = 7
/**
 * How much the colour counts next to the model's similarity: the colour of a window and of an artwork
 * agree between -1 and 1, and a hair's breadth between two look-alikes (0.01 to 0.03) is settled by it,
 * while a card that the model puts clearly ahead (0.1 and more) stays ahead.
 */
export const ART_COLOR_WEIGHT = 0.1

/**
 * A match with the colour taken into account: the best card and its rivals are put in order by their
 * similarity plus `ART_COLOR_WEIGHT` times how well the artwork's colour agrees with the window's
 * (`windowMean` is the colour the photo's windows share, see `colorSimilarity`). The similarity stays
 * the model's, so the thresholds on it hold; the margin is the gap of the scores. A card without a
 * colour counts by the model alone; an index without colours or a match without rivals is left as it is.
 */
export function rerankByColor(match: ArtMatch, index: ArtIndex, windowColor: ArrayLike<number>, windowMean: ArrayLike<number>): ArtMatch {
  const colors = index.colors
  if (!colors || !match.runnersUp || match.runnersUp.length === 0) {
    return match
  }
  const scored = [{ cardId: match.cardId, similarity: match.similarity }, ...match.runnersUp].map((candidate) => {
    const row = colors.rowOfCard.get(candidate.cardId)
    const agreement = row === undefined ? 0 : colorSimilarity(windowColor, windowMean, dequantizeColor(colors.values, row * ART_COLOR_DIMENSION), colors.mean)
    return { ...candidate, score: candidate.similarity + ART_COLOR_WEIGHT * agreement }
  }).sort((a, b) => b.score - a.score)
  const best = scored[0]!
  const second = scored[1]
  return {
    cardId: best.cardId,
    similarity: best.similarity,
    margin: second ? best.score - second.score : best.score,
    runnersUp: scored.slice(1, ART_RUNNERS_UP + 1).map(({ cardId, similarity }) => ({ cardId, similarity })),
  }
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
export function refinementCandidates(hits: readonly ArtHit[], minMargin = ART_REFINE_MIN_MARGIN, limit = ART_REFINE_MAX_PLACES, minSimilarity?: number): ArtHit[] {
  const byCard = new Map<number, ArtHit[]>()
  for (const hit of hits) {
    if (hit.margin >= minMargin || (minSimilarity !== undefined && hit.similarity >= minSimilarity)) {
      byCard.set(hit.cardId, [...(byCard.get(hit.cardId) ?? []), hit])
    }
  }
  const places = [...byCard.values()].flatMap(list => artPlaces(list).slice(0, REFINE_PLACES_PER_CARD).map(place => place.best))
  // The clear places first; places that matched closely but not clearly (a look-alike a hair ahead) after them.
  const rank = (hit: ArtHit) => hit.margin >= minMargin ? 1 + hit.margin : hit.similarity
  return places.sort((a, b) => rank(b) - rank(a)).slice(0, limit)
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
 * A hub (`ArtIndexMeta.hubs`) wins windows of photo after photo that it is not on, so for it a clear lead
 * and six windows are no proof: it is only called sure with a much clearer lead, a closer match and more windows.
 */
export const HUB_SURE_MARGIN = 0.15
export const HUB_SURE_SIMILARITY = 0.5
export const HUB_SURE_SUPPORT = 10
/** A photo that lists only the sure cards needs this many times the windows for a sure card (cards of such photos had 17 to 161 windows, the cards that were not there 6 to 11). */
export const FEW_CARDS_SURE_SUPPORT_FACTOR = 2
/**
 * A further place counts as another copy of a card when it is as good as a card of its own would
 * have to be: at least this share as clear as the best place, clear enough to be sure, shown by
 * this many windows (a lucky window of a look-alike elsewhere is no copy), and a card's width away
 * from the places already counted (windows far apart on one large picture are one card).
 */
const FURTHER_COPY_SHARE = 0.6
const FURTHER_COPY_SUPPORT = 3
const FURTHER_COPY_DISTANCE = 1.2
/**
 * Copies of a card that is listed are also counted by a looser measure: places where it is the closest card
 * of at least this many windows that are this close and this far ahead, whatever the card's best place is. A
 * grid of identical cards (twelve times the same spell) leaves each place with a narrow lead, because a
 * look-alike is always a hair behind, and the strict measure above sees one or two of them.
 */
const LOOSE_COPY_SUPPORT = 2
const LOOSE_COPY_SIMILARITY = 0.35
const LOOSE_COPY_MARGIN = 0.03

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
 * (the one furthest ahead) is its strength. Places far enough apart with the same card are copies
 * (a card that is listed also gets its copies counted by a looser measure, see `LOOSE_COPY_SUPPORT`).
 * A place holds one card: when a second card claims the place of a clearer one it is not sure (a
 * look-alike or a generic picture), and when the two are about equally clear neither is. A hub (a
 * card in `hubs`) is only sure with overwhelming evidence. With `onlySure` only the sure cards are
 * returned: a photo of one card or two has no room for the doubtful ones that the frame, the text
 * and the table of a card give.
 */
export function cardsFromHits(hits: readonly ArtHit[], options: { onlySure?: boolean, supportScale?: number, hubs?: ReadonlySet<number> } = {}): ArtCard[] {
  // A sparser look at the photo gives every card fewer windows: the support it needs shrinks with it.
  const scale = options.supportScale ?? 1
  const minSupport = Math.max(2, Math.round(ART_MIN_SUPPORT * scale))
  // A photo of few cards (`onlySure`) shows each of them from many windows, and the frame and the glare of a card give a few windows to a card that is not there.
  const sureSupport = Math.max(minSupport, Math.round(ART_SURE_SUPPORT * scale * (options.onlySure ? FEW_CARDS_SURE_SUPPORT_FACTOR : 1)))
  const hubSupport = Math.max(sureSupport, Math.round(HUB_SURE_SUPPORT * scale))
  const byCard = new Map<number, ArtHit[]>()
  const looseByCard = new Map<number, ArtHit[]>()
  for (const hit of hits) {
    if (hit.similarity >= ART_SUPPORT_SIMILARITY && hit.margin >= ART_SUPPORT_MARGIN) {
      byCard.set(hit.cardId, [...(byCard.get(hit.cardId) ?? []), hit])
    }
    if (hit.similarity >= LOOSE_COPY_SIMILARITY && hit.margin >= LOOSE_COPY_MARGIN) {
      looseByCard.set(hit.cardId, [...(looseByCard.get(hit.cardId) ?? []), hit])
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
        copies: Math.max(copies.length, looseCopies(looseByCard.get(cardId) ?? [])),
        support: list.length,
        sure: best.margin >= ART_SURE_MARGIN && best.similarity >= ART_SURE_SIMILARITY && list.length >= sureSupport
          && (!options.hubs?.has(cardId) || (best.margin >= HUB_SURE_MARGIN && best.similarity >= HUB_SURE_SIMILARITY && list.length >= hubSupport)),
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

/** The places of a card's close hits that several windows agree on, without any two of them being one picture seen from two corners. */
function looseCopies(hits: readonly ArtHit[]): number {
  const kept: ArtHit[] = []
  for (const place of artPlaces(hits).filter(candidate => candidate.support >= LOOSE_COPY_SUPPORT).sort((a, b) => b.support - a.support)) {
    if (kept.every(copy => !oneWindowCoversBoth(hits, copy.window, place.best.window))) {
      kept.push(place.best)
    }
  }
  return kept.length
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

/**
 * Windows on artworks of many different cards share little but the photo (its light, its sleeves): their mean
 * vector is short (0.78 to 0.84 on 20 photos). Those of a photo of one card many times (a grid of twelve) are
 * alike, their mean is the card and 0.89 to 0.94 long; taking it off takes the card off, so there the mean of
 * many photos (`photoMean` of the index) is used instead, with a stretch in between.
 */
const ALIGNED_FEW_CARDS_FROM = 0.85
const ALIGNED_FEW_CARDS_TO = 0.88

/**
 * Brings the vectors of windows that sit on artworks (`alignedWindows`) to the catalog's side: the photo's own
 * mean of them is taken off (for a photo of few cards, the mean of many photos, see `ALIGNED_FEW_CARDS_FROM`),
 * each part is made a unit vector again. Nothing more: the strongest directions of such windows are the artworks
 * themselves, taking those off (`photoCorrection`) takes the cards away.
 */
export function alignedCorrection(vectors: readonly Float32Array[], photoMean?: ArrayLike<number>): Float32Array[] {
  const mean = meanVector(vectors)
  if (photoMean && photoMean.length === mean.length) {
    // The length of the patch part of the mean (the class part is as long, but the patches are what the artwork is).
    let length = 0
    for (let d = ART_DIMENSION; d < mean.length; d += 1) {
      length += mean[d]! ** 2
    }
    const own = Math.min(1, Math.max(0, (ALIGNED_FEW_CARDS_TO - Math.sqrt(length)) / (ALIGNED_FEW_CARDS_TO - ALIGNED_FEW_CARDS_FROM)))
    for (let d = 0; d < mean.length; d += 1) {
      mean[d] = own * mean[d]! + (1 - own) * photoMean[d]!
    }
  }
  return vectors.map(vector => joinParts(part => normalize(vector.slice(part * ART_DIMENSION, (part + 1) * ART_DIMENSION).map((value, d) => value - mean[part * ART_DIMENSION + d]!))))
}

/**
 * What a box looks like, for telling copies of one card from different cards: the mean of its windows' patch parts
 * (unit vectors) as a unit vector. Two boxes of the same card were 0.83 to 0.98 alike (median 0.93, 63 pairs on 13
 * photos); different cards 0.65 (median), 0.78 (95 % of the pairs below) to 0.88 (369 pairs).
 */
export function boxVector(windows: readonly Float32Array[]): Float32Array {
  const sum = new Float32Array(ART_DIMENSION)
  for (const window of windows) {
    const part = normalize(window.slice(ART_DIMENSION, ART_VECTOR))
    for (let d = 0; d < ART_DIMENSION; d += 1) {
      sum[d]! += part[d]!
    }
  }
  return normalize(sum)
}

/** What a box of `findArtBoxes` shows: its best window's card, and how many of the box's windows agree. */
export interface BoxMatch {
  cardId: number
  similarity: number
  margin: number
  support: number
  /** What the box looks like (`boxVector`): a box that looks like a box that is sure for a card is a copy of it. */
  vector?: ArrayLike<number>
}

/** A box this alike a box that is sure for a card, and not sure for another card itself, is one more copy of that card. */
export const BOX_COPY_SIMILARITY = 0.85

/**
 * A card on a window that sits on its artwork is sure with this lead and closeness (a sliding window needs windows
 * from many sides instead). On 16 photos with a known list of cards, the cards sure / the wrong ones sure were 127 / 12
 * with a lead of 0.05, 126 / 8 at 0.06, 125 / 7 at 0.07, 121 / 3 at 0.08 and 110 / 1 at 0.10, the same in both groups of photos.
 */
export const ALIGNED_SURE_MARGIN = 0.08
export const ALIGNED_SURE_SIMILARITY = 0.4
/** And it is worth listing, for a name read from the photo to confirm, with this much. */
export const ALIGNED_MIN_MARGIN = 0.03
export const ALIGNED_MIN_SIMILARITY = 0.35

function similarityOf(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let sum = 0
  for (let d = 0; d < a.length; d += 1) {
    sum += a[d]! * b[d]!
  }
  return sum
}

/**
 * The cards of a photo from the boxes of its artworks: every box is one card, so a card on several boxes is that
 * many copies. A box decides for its card with a clear lead (a hub with the larger lead and closeness it needs
 * everywhere, see `HUB_SURE_MARGIN`); one that is only close is listed, doubtful. A box that looks like a box
 * that is sure for a card (`BOX_COPY_SIMILARITY`) is another copy of that card whatever its own best card is (a
 * look-alike a hair ahead is common in a grid of the same card), unless it is sure for another card itself.
 */
export function cardsFromBoxes(boxes: readonly BoxMatch[], options: { hubs?: ReadonlySet<number> } = {}): ArtCard[] {
  const isSure = (box: BoxMatch) => options.hubs?.has(box.cardId) === true
    ? box.margin >= HUB_SURE_MARGIN && box.similarity >= HUB_SURE_SIMILARITY
    : box.margin >= ALIGNED_SURE_MARGIN && box.similarity >= ALIGNED_SURE_SIMILARITY
  const isListed = (box: BoxMatch) => box.margin >= ALIGNED_MIN_MARGIN && box.similarity >= ALIGNED_MIN_SIMILARITY
  const sureBoxes = boxes.filter(box => isSure(box))

  // The card each box stands for: its own when sure, a sure card it looks like (the likest), or its own when listed.
  const standsFor = boxes.map((box) => {
    if (isSure(box)) {
      return box.cardId
    }
    let like: { cardId: number, similarity: number } | null = null
    for (const anchor of sureBoxes) {
      const similarity = box.vector && anchor.vector ? similarityOf(box.vector, anchor.vector) : 0
      if (similarity >= BOX_COPY_SIMILARITY && similarity > (like?.similarity ?? 0)) {
        like = { cardId: anchor.cardId, similarity }
      }
    }
    return like?.cardId ?? (isListed(box) ? box.cardId : null)
  })

  const cards: ArtCard[] = []
  for (const cardId of new Set(standsFor.filter((id): id is number => id !== null))) {
    const standing = boxes.filter((_box, i) => standsFor[i] === cardId)
    const own = standing.filter(box => box.cardId === cardId && isListed(box))
    if (own.length === 0) {
      continue
    }
    const best = [...own].sort((a, b) => b.margin - a.margin)[0]!
    cards.push({
      cardId,
      similarity: best.similarity,
      margin: best.margin,
      copies: Math.max(1, standing.length),
      support: Math.max(1, own.reduce((sum, box) => sum + box.support, 0)),
      sure: standing.some(box => box.cardId === cardId && isSure(box)),
    })
  }
  return cards.sort((a, b) => b.margin - a.margin)
}
