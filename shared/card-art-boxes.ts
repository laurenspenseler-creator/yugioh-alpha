// Where the artworks of a photo are, from the patch tokens of the model itself (ADR 0041).
//
// DINOv2 gives a token for every 14 × 14 pixel patch of what it looks at. Looked at in 224 × 224 tiles, the tokens
// of a photo of cards on a table separate cleanly: the table is one kind of patch, a card something else, and
// the picture of a card something else again, even where sleeved cards touch (their borders are patches of their
// own). So the cards are the patches unlike the table, and within them the artworks are the patches like an
// artwork (`artPrototype`, the mean token of many catalog artworks). The boxes that come out sit within a patch
// (14 pixels) of the real artwork, where a window of a sliding scan is half a window off at best.

/** The side of a patch, in pixels of the picture the model looked at. */
export const PATCH_SIZE = 14
/** The side of a tile the model takes, in pixels, and in patches. */
export const TILE_SIZE = 224
export const TILE_PATCHES = TILE_SIZE / PATCH_SIZE

/** A region has to be at least this many patches on each side, and not longer than this many times its shorter side, to be an artwork. */
const MIN_SIDE = 5
const MAX_ASPECT = 1.5
const MIN_AREA = 20
/** The table is taken from the brightest quarter of the patches. */
const TABLE_SHARE = 0.25

export interface ArtBox {
  /** In patches; the end is exclusive. */
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface PatchMap {
  /** The tokens of all patches, `gridRows × gridCols` rows of `dimension` numbers, row by row. */
  features: Float32Array
  dimension: number
  gridCols: number
  gridRows: number
  /** The part of the grid the picture covers (the grid is whole tiles, the picture is not). */
  cols: number
  rows: number
  /** How bright each patch of the picture is, `cols × rows`. */
  luminance: Float32Array
}

/** The threshold that splits the values into a low and a high group with the largest difference between them (Otsu). */
function otsu(values: readonly number[], bins = 64): number {
  let low = Infinity
  let high = -Infinity
  for (const value of values) {
    low = Math.min(low, value)
    high = Math.max(high, value)
  }
  if (!(high > low)) {
    return low
  }
  const histogram = new Float64Array(bins)
  for (const value of values) {
    histogram[Math.min(bins - 1, Math.floor(((value - low) / (high - low)) * bins))]! += 1
  }
  let total = 0
  for (let i = 0; i < bins; i += 1) {
    total += i * histogram[i]!
  }
  let below = 0
  let sumBelow = 0
  let best = 0
  let split = 0
  for (let i = 0; i < bins; i += 1) {
    below += histogram[i]!
    if (below === 0) {
      continue
    }
    const above = values.length - below
    if (above === 0) {
      break
    }
    sumBelow += i * histogram[i]!
    const between = below * above * (sumBelow / below - (total - sumBelow) / above) ** 2
    if (between > best) {
      best = between
      split = i
    }
  }
  return low + ((split + 1) / bins) * (high - low)
}

function norm(map: PatchMap, patch: number): number {
  let sum = 0
  for (let d = 0; d < map.dimension; d += 1) {
    const value = map.features[patch * map.dimension + d]!
    sum += value * value
  }
  return Math.sqrt(sum) || 1
}

/** Erosion then dilation by one patch (four neighbours): thin bridges between two regions go, regions stay. */
function open(mask: Uint8Array, cols: number, rows: number): Uint8Array {
  const at = (m: Uint8Array, x: number, y: number) => x >= 0 && y >= 0 && x < cols && y < rows ? m[y * cols + x]! : 0
  const eroded = new Uint8Array(mask.length)
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      eroded[y * cols + x] = at(mask, x, y) && at(mask, x + 1, y) && at(mask, x - 1, y) && at(mask, x, y + 1) && at(mask, x, y - 1) ? 1 : 0
    }
  }
  const dilated = new Uint8Array(mask.length)
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      dilated[y * cols + x] = at(eroded, x, y) || at(eroded, x + 1, y) || at(eroded, x - 1, y) || at(eroded, x, y + 1) || at(eroded, x, y - 1) ? 1 : 0
    }
  }
  return dilated
}

/** The connected regions of a mask, as boxes with their area. */
function regions(mask: Uint8Array, cols: number, rows: number): Array<ArtBox & { area: number }> {
  const seen = new Uint8Array(mask.length)
  const out: Array<ArtBox & { area: number }> = []
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || seen[start]) {
      continue
    }
    const stack = [start]
    seen[start] = 1
    let x0 = cols
    let y0 = rows
    let x1 = 0
    let y1 = 0
    let area = 0
    while (stack.length > 0) {
      const at = stack.pop()!
      const x = at % cols
      const y = (at - x) / cols
      area += 1
      x0 = Math.min(x0, x)
      y0 = Math.min(y0, y)
      x1 = Math.max(x1, x)
      y1 = Math.max(y1, y)
      for (const next of [at + 1, at - 1, at + cols, at - cols]) {
        if (next < 0 || next >= mask.length || !mask[next] || seen[next]) {
          continue
        }
        // No wrapping from the end of a row to the start of the next.
        if ((next === at + 1 && x === cols - 1) || (next === at - 1 && x === 0)) {
          continue
        }
        seen[next] = 1
        stack.push(next)
      }
    }
    out.push({ x0, y0, x1: x1 + 1, y1: y1 + 1, area })
  }
  return out
}

/**
 * The boxes of the artworks on a photo, in patches, top to bottom and left to right. `artPrototype` is the mean
 * (unit) token of the patches inside many catalog artworks. Photos with no table to tell the cards from (every patch
 * alike) have none.
 */
export function findArtBoxes(map: PatchMap, artPrototype: ArrayLike<number>): ArtBox[] {
  const { cols, rows, gridCols, dimension } = map
  const count = cols * rows
  if (count < MIN_AREA || artPrototype.length !== dimension) {
    return []
  }
  const gridAt = (index: number) => Math.floor(index / cols) * gridCols + (index % cols)

  // The table: the mean token of the brightest quarter of the patches.
  const brightest = [...Array.from({ length: count }, (_, i) => i)].sort((a, b) => map.luminance[b]! - map.luminance[a]!).slice(0, Math.max(1, Math.floor(count * TABLE_SHARE)))
  const table = new Float64Array(dimension)
  for (const index of brightest) {
    const patch = gridAt(index)
    const length = norm(map, patch)
    for (let d = 0; d < dimension; d += 1) {
      table[d]! += map.features[patch * dimension + d]! / length / brightest.length
    }
  }
  let tableLength = 0
  for (let d = 0; d < dimension; d += 1) {
    tableLength += table[d]! ** 2
  }
  tableLength = Math.sqrt(tableLength) || 1

  const tableCosine = new Float32Array(count)
  const artCosine = new Float32Array(count)
  for (let index = 0; index < count; index += 1) {
    const patch = gridAt(index)
    let toTable = 0
    let toArt = 0
    for (let d = 0; d < dimension; d += 1) {
      const value = map.features[patch * dimension + d]!
      toTable += value * table[d]!
      toArt += value * artPrototype[d]!
    }
    const length = norm(map, patch)
    tableCosine[index] = toTable / length / tableLength
    artCosine[index] = toArt / length
  }

  // Cards: unlike the table. Artworks: among the card patches, the ones like an artwork.
  const cardSplit = otsu(Array.from(tableCosine))
  const onCard: number[] = []
  for (let index = 0; index < count; index += 1) {
    if (tableCosine[index]! < cardSplit) {
      onCard.push(index)
    }
  }
  if (onCard.length < MIN_AREA) {
    return []
  }
  const artSplit = otsu(onCard.map(index => artCosine[index]!))
  const art = new Uint8Array(count)
  for (const index of onCard) {
    if (artCosine[index]! >= artSplit) {
      art[index] = 1
    }
  }

  return regions(open(art, cols, rows), cols, rows)
    .filter((region) => {
      const width = region.x1 - region.x0
      const height = region.y1 - region.y0
      return region.area >= MIN_AREA && width >= MIN_SIDE && height >= MIN_SIDE && Math.max(width, height) / Math.min(width, height) < MAX_ASPECT
    })
    .map(({ x0, y0, x1, y1 }) => ({ x0, y0, x1, y1 }))
    .sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0)
}

export interface AlignedWindow {
  /** Which box of `findArtBoxes` the window belongs to. */
  box: number
  x: number
  y: number
  size: number
}

/** A box's artwork as windows: a little larger than the box (it is the picture, the model sees the edge), a few sizes and half a patch moved each way. */
export const ALIGNED_SIZES = [1, 1.15] as const
export const ALIGNED_SHIFTS: ReadonlyArray<readonly [number, number]> = [[0, 0], [0.5, 0], [-0.5, 0], [0, 0.5], [0, -0.5]]

/**
 * The windows to look at for the boxes, in pixels of a picture `width × height`, every one inside it. A slower
 * device takes fewer `shifts` (`ALIGNED_SHIFTS` is the usual set), the first of them should be `[0, 0]`.
 */
export function alignedWindows(boxes: readonly ArtBox[], width: number, height: number, shifts: ReadonlyArray<readonly [number, number]> = ALIGNED_SHIFTS): AlignedWindow[] {
  const windows: AlignedWindow[] = []
  boxes.forEach((box, index) => {
    const centreX = (box.x0 + box.x1) / 2
    const centreY = (box.y0 + box.y1) / 2
    const side = Math.max(box.x1 - box.x0, box.y1 - box.y0)
    for (const factor of ALIGNED_SIZES) {
      const size = Math.min(Math.round(side * PATCH_SIZE * factor), width, height)
      for (const [dx, dy] of shifts) {
        windows.push({
          box: index,
          size,
          x: Math.max(0, Math.min(width - size, Math.round((centreX + dx) * PATCH_SIZE - size / 2))),
          y: Math.max(0, Math.min(height - size, Math.round((centreY + dy) * PATCH_SIZE - size / 2))),
        })
      }
    }
  })
  return windows
}
