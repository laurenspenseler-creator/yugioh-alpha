// The colour of an artwork, a second cue next to the vision model's vector (ADR 0041). The model sees
// shapes and is almost blind to colour, so two artworks with the same swirl or the same blob but
// other colours (Polymerization and the other Fusion spells) are a hair apart for it; the colours
// of a window on a photo and of an artwork in the catalog tell them apart. A picture's colour is
// the mean chromaticity of the cells of a grid over it: coarse, so that a window that sits a little
// beside the artwork or is zoomed does not change it much.

/** The picture is divided into this many cells in each direction. */
export const ART_COLOR_GRID = 3
/** Per cell: log(red / green) and log(blue / green). */
export const ART_COLOR_DIMENSION = ART_COLOR_GRID * ART_COLOR_GRID * 2
/** A little is added to every channel before the ratios, so that a dark cell does not give wild numbers. */
const FLOOR = 8
/** Stored as int8 at this scale (the numbers lie between about -2 and 2). */
const STORE_SCALE = 64

/** The colour of a picture of `width` x `height` pixels with `channels` (3 or 4) bytes each: red, green, blue first. */
export function artColorDescriptor(pixels: ArrayLike<number>, width: number, height: number, channels: 3 | 4 = 4): Float32Array {
  const cells = ART_COLOR_GRID * ART_COLOR_GRID
  const sums = new Float64Array(cells * 3)
  const counts = new Float64Array(cells)
  for (let y = 0; y < height; y += 1) {
    const row = Math.min(ART_COLOR_GRID - 1, Math.floor(y * ART_COLOR_GRID / height))
    for (let x = 0; x < width; x += 1) {
      const cell = row * ART_COLOR_GRID + Math.min(ART_COLOR_GRID - 1, Math.floor(x * ART_COLOR_GRID / width))
      const at = (y * width + x) * channels
      sums[cell * 3]! += pixels[at]!
      sums[cell * 3 + 1]! += pixels[at + 1]!
      sums[cell * 3 + 2]! += pixels[at + 2]!
      counts[cell]! += 1
    }
  }
  const out = new Float32Array(ART_COLOR_DIMENSION)
  for (let cell = 0; cell < cells; cell += 1) {
    const n = Math.max(1, counts[cell]!)
    const red = sums[cell * 3]! / n + FLOOR
    const green = sums[cell * 3 + 1]! / n + FLOOR
    const blue = sums[cell * 3 + 2]! / n + FLOOR
    out[cell * 2] = Math.log(red / green)
    out[cell * 2 + 1] = Math.log(blue / green)
  }
  return out
}

export function quantizeColor(descriptor: ArrayLike<number>): Int8Array {
  return Int8Array.from({ length: ART_COLOR_DIMENSION }, (_, i) => Math.max(-127, Math.min(127, Math.round(descriptor[i]! * STORE_SCALE))))
}

export function dequantizeColor(values: ArrayLike<number>, start = 0): Float32Array {
  return Float32Array.from({ length: ART_COLOR_DIMENSION }, (_, i) => values[start + i]! / STORE_SCALE)
}

/** The mean of descriptors (for the catalog: the colour all artworks share; for a photo: the cast of its light). */
export function meanColor(descriptors: readonly ArrayLike<number>[]): Float32Array {
  const mean = new Float32Array(ART_COLOR_DIMENSION)
  for (const descriptor of descriptors) {
    for (let d = 0; d < ART_COLOR_DIMENSION; d += 1) {
      mean[d]! += descriptor[d]! / descriptors.length
    }
  }
  return mean
}

/**
 * How alike two colours are, from -1 to 1: the cosine of the descriptors after the colour that
 * their side shares is taken off (`windowMean` of the photo's windows, `catalogMean` of the artworks),
 * which is the tint of the light on one side and the tint of printing on the other.
 */
export function colorSimilarity(window: ArrayLike<number>, windowMean: ArrayLike<number>, card: ArrayLike<number>, catalogMean: ArrayLike<number>): number {
  let dot = 0
  let a = 0
  let b = 0
  for (let d = 0; d < ART_COLOR_DIMENSION; d += 1) {
    const x = window[d]! - windowMean[d]!
    const y = card[d]! - catalogMean[d]!
    dot += x * y
    a += x * x
    b += y * y
  }
  return dot / (Math.sqrt(a * b) + 1e-9)
}
