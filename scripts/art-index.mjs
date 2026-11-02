// Builds the index of catalog artworks that recognizes cards on photos (ADR 0041):
//
//   node scripts/art-index.mjs               add the artworks the index does not have yet (all of them on a first run)
//   node scripts/art-index.mjs --limit 50    stop after 50 new artworks (to try it)
//   node scripts/art-index.mjs --colors-only give the artworks of an older index their colours, nothing else
//
// The cropped artwork of every card in the catalog (`catalog_card_image`) is downloaded from
// YGOPRODeck, turned into two vectors of 384 numbers (the class token and the mean of the patch
// tokens) by the same vision model the browser uses (DINOv2-small, 8-bit), and stored in
// `public/ai/art/index.json` + `index.bin` (about 23 MB; the format is described in
// shared/card-art.ts; the file is committed), together with the colour of every artwork
// (`colors.bin`, see shared/card-color.ts). Nothing but the vectors and the colours is kept, so a
// rerun after a catalog sync only fetches the new cards. A first run downloads about 2.5 GB and
// takes an hour. With ART_CROPS_DIR set to a folder of cropped artworks (`<artwork id>.jpg`) they
// are read from there instead of being downloaded; an index that has no colours yet gets them
// from the artworks again (this is the only thing it then does, the vectors stay as they are).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { AutoModel, RawImage, Tensor } from '@huggingface/transformers'
import { ART_DIMENSION, ART_PARTS, ART_VECTOR, artVectorFromTokens, quantizeArtVector } from '../shared/card-art.ts'
import { ART_COLOR_DIMENSION, artColorDescriptor, dequantizeColor, meanColor, quantizeColor } from '../shared/card-color.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = process.env.ART_INDEX_DIR || join(root, 'public', 'ai', 'art')
const MODEL = 'Xenova/dinov2-small'
const SIZE = 224
const MEAN = [0.485, 0.456, 0.406]
const STD = [0.229, 0.224, 0.225]
const BATCH = 8
const DOWNLOADS_AT_ONCE = 6

const limitAt = process.argv.indexOf('--limit')
const limit = limitAt === -1 ? Infinity : Number(process.argv[limitAt + 1])

const dbPath = process.env.NUXT_DB_FILE_PATH || join(root, 'data', 'app.db')
const db = new Database(dbPath, { readonly: true })
const rows = db.prepare(`
  select i.id as imageId, i.card_id as cardId, i.image_url_cropped as url
  from catalog_card_image i join catalog_card c on c.id = i.card_id
  where c.retired_at is null and i.image_url_cropped is not null
  order by i.id`).all()

// Every artwork gets two vectors: as it is, and blurred, which is what a photo that is not quite sharp
// makes of it (the first looks for the second on blurred photos and finds it; the matching takes the
// better of the two for a card). `variants[i]` says which one vector `i` is. The blur is 3 pixels (1.5
// before round 8; of 1.5, 3, 4.5 and 6 it found the most boxes of 16 photos, 204 against 200 of 251).
const BLURS = [0, 3]

// What the index already has: the vectors stay as they are (int8 and their scale).
const known = new Map()
const metaFile = join(outDir, 'index.json')
const binFile = join(outDir, 'index.bin')
const colorsFile = join(outDir, 'colors.bin')
const cropsDir = process.env.ART_CROPS_DIR
/** The colour of every artwork (int8, see `quantizeColor`) and the place its vectors have in the index, so that it keeps it. */
const colors = new Map()
const position = new Map()
// The mean window vector of many photos (what a photo of few cards is corrected by, see
// `photoCorrection` in shared/card-art.ts) is estimated from photos, not from the artworks: it is kept.
// The hubs (cards that win windows of photo after photo that they are not on, see `ArtIndexMeta.hubs`) are
// estimated from photos with a known list of cards as well, and kept the same way.
let photoMean
let hubs
// The mean token of the patches inside many artworks (`ArtIndexMeta.artPrototype`, what `findArtBoxes` takes for the picture of a card) is kept as well.
let artPrototype
if (existsSync(metaFile) && existsSync(binFile)) {
  const meta = JSON.parse(readFileSync(metaFile, 'utf8'))
  photoMean = meta.photoMean
  hubs = meta.hubs
  artPrototype = meta.artPrototype
  // An index of an older format (or one without blurred copies) is rebuilt from scratch.
  if (meta.version === 2 && meta.variants) {
    const binary = readFileSync(binFile)
    const scaleBytes = meta.count * ART_PARTS * 4
    const scales = new Float32Array(binary.buffer.slice(binary.byteOffset, binary.byteOffset + scaleBytes))
    const values = new Int8Array(binary.buffer.slice(binary.byteOffset + scaleBytes, binary.byteOffset + scaleBytes + meta.count * ART_VECTOR))
    meta.imageIds.forEach((imageId, i) => {
      known.set(`${imageId}:${meta.variants[i]}`, { imageId, variant: meta.variants[i], cardId: meta.cardIds[i], scales: [...scales.slice(i * ART_PARTS, (i + 1) * ART_PARTS)], values: values.slice(i * ART_VECTOR, (i + 1) * ART_VECTOR) })
      position.set(`${imageId}:${meta.variants[i]}`, i)
    })
    if (meta.colors === ART_COLOR_DIMENSION && existsSync(colorsFile)) {
      const stored = new Int8Array(readFileSync(colorsFile).buffer.slice(0))
      meta.imageIds.forEach((imageId, i) => colors.set(imageId, stored.slice(i * ART_COLOR_DIMENSION, (i + 1) * ART_COLOR_DIMENSION)))
    }
  }
}

const needsVectors = row => BLURS.some((_blur, variant) => !known.has(`${row.imageId}:${variant}`))
const needsColor = row => !colors.has(row.imageId)
// With --colors-only the artworks the index does not have are left for the next real update.
const colorsOnly = process.argv.includes('--colors-only')
const todo = rows.filter(row => colorsOnly ? !needsVectors(row) && needsColor(row) : needsVectors(row) || needsColor(row)).slice(0, limit)
console.log(`${rows.length} artworks in the catalog, ${known.size} vectors in the index, ${todo.length} artworks to add or to give a colour`)

/** An RGB picture (bytes, `size` x `size`) blurred with a Gaussian of standard deviation `sigma` pixels. */
function blurred(pixels, size, sigma) {
  if (sigma === 0) {
    return pixels
  }
  const radius = Math.ceil(3 * sigma)
  const kernel = Array.from({ length: 2 * radius + 1 }, (_, i) => Math.exp(-((i - radius) ** 2) / (2 * sigma * sigma)))
  const sum = kernel.reduce((a, b) => a + b, 0)
  const pass = (from, horizontal) => {
    const out = new Float32Array(from.length)
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        for (let c = 0; c < 3; c += 1) {
          let value = 0
          for (let k = -radius; k <= radius; k += 1) {
            const at = horizontal ? y * size + Math.min(size - 1, Math.max(0, x + k)) : Math.min(size - 1, Math.max(0, y + k)) * size + x
            value += from[at * 3 + c] * kernel[k + radius]
          }
          out[(y * size + x) * 3 + c] = value / sum
        }
      }
    }
    return out
  }
  return pass(pass(pixels, true), false)
}

const failed = []
if (todo.length > 0) {
  // The vision model is only needed for artworks that have no vectors yet.
  const model = todo.some(needsVectors) ? await AutoModel.from_pretrained(MODEL, { dtype: 'q8' }) : null

  /** The picture of an artwork, from the folder of crops or from the web. */
  const picture = async (row) => {
    const file = cropsDir ? join(cropsDir, `${row.imageId}.jpg`) : null
    if (file && existsSync(file)) {
      return await RawImage.fromBlob(new Blob([readFileSync(file)]))
    }
    const response = await fetch(row.url)
    if (!response.ok) {
      throw new Error(String(response.status))
    }
    return await RawImage.fromBlob(await response.blob())
  }

  /** The colour of the artwork, and the model's input for each blur that has no vector yet (null for the others). */
  const pixels = async (row) => {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        const resized = await (await picture(row)).rgb().resize(SIZE, SIZE)
        colors.set(row.imageId, quantizeColor(artColorDescriptor(resized.data, SIZE, SIZE, 3)))
        return BLURS.map((sigma, variant) => {
          if (known.has(`${row.imageId}:${variant}`)) {
            return null
          }
          const source = blurred(resized.data, SIZE, sigma)
          const data = new Float32Array(3 * SIZE * SIZE)
          const plane = SIZE * SIZE
          for (let i = 0; i < plane; i += 1) {
            for (let c = 0; c < 3; c += 1) {
              data[c * plane + i] = (source[i * 3 + c] / 255 - MEAN[c]) / STD[c]
            }
          }
          return data
        })
      }
      catch {
        if (attempt === 3) {
          failed.push(row.imageId)
          return null
        }
        await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)))
      }
    }
    return null
  }

  const started = Date.now()
  for (let at = 0; at < todo.length; at += BATCH * DOWNLOADS_AT_ONCE) {
    // Downloads run side by side; the model gets the pictures eight at a time.
    const chunk = todo.slice(at, at + BATCH * DOWNLOADS_AT_ONCE)
    const decoded = await Promise.all(chunk.map(pixels))
    const ready = chunk.flatMap((row, i) => (decoded[i] ?? []).flatMap((data, variant) => data ? [{ row, variant, data }] : []))
    for (let b = 0; b < ready.length; b += BATCH) {
      const group = ready.slice(b, b + BATCH)
      const input = new Float32Array(group.length * 3 * SIZE * SIZE)
      group.forEach((entry, i) => input.set(entry.data, i * 3 * SIZE * SIZE))
      const { last_hidden_state: hidden } = await model({ pixel_values: new Tensor('float32', input, [group.length, 3, SIZE, SIZE]) })
      const tokens = hidden.dims[1]
      group.forEach((entry, i) => {
        const { scales, values } = quantizeArtVector(artVectorFromTokens(hidden.data, i * tokens * ART_DIMENSION, tokens))
        known.set(`${entry.row.imageId}:${entry.variant}`, { imageId: entry.row.imageId, variant: entry.variant, cardId: entry.row.cardId, scales, values })
      })
    }
    console.log(`${Math.min(at + chunk.length, todo.length)}/${todo.length}, ${Math.round((Date.now() - started) / 1000)} s`)
  }
}

// Only artworks of cards that are still in the catalog stay. What the index had keeps its place, so that
// a rerun that adds nothing writes the same file; new artworks follow in the catalog's order. An artwork
// whose colour could not be fetched leaves the index as it is.
const current = new Set(rows.map(row => row.imageId))
const placeOf = entry => position.get(`${entry.imageId}:${entry.variant}`) ?? Infinity
const entries = [...known.values()].filter(entry => current.has(entry.imageId) && colors.has(entry.imageId)).sort((a, b) => placeOf(a) - placeOf(b) || a.imageId - b.imageId || a.variant - b.variant)
const scales = new Float32Array(entries.length * ART_PARTS)
const values = new Int8Array(entries.length * ART_VECTOR)
const stored = new Int8Array(entries.length * ART_COLOR_DIMENSION)
entries.forEach((entry, i) => {
  scales.set(entry.scales, i * ART_PARTS)
  values.set(entry.values, i * ART_VECTOR)
  stored.set(colors.get(entry.imageId), i * ART_COLOR_DIMENSION)
})
const meta = {
  version: 2,
  model: MODEL,
  dimension: ART_DIMENSION,
  parts: ART_PARTS,
  count: entries.length,
  cardIds: entries.map(entry => entry.cardId),
  imageIds: entries.map(entry => entry.imageId),
  variants: entries.map(entry => entry.variant),
  ...(photoMean ? { photoMean } : {}),
  ...(hubs ? { hubs } : {}),
  ...(artPrototype ? { artPrototype } : {}),
  colors: ART_COLOR_DIMENSION,
  colorMean: [...meanColor(entries.map((_entry, i) => dequantizeColor(stored, i * ART_COLOR_DIMENSION)))].map(value => Math.round(value * 1e4) / 1e4),
}
mkdirSync(outDir, { recursive: true })
writeFileSync(metaFile, JSON.stringify(meta))
writeFileSync(binFile, Buffer.concat([Buffer.from(scales.buffer), Buffer.from(values.buffer)]))
writeFileSync(colorsFile, Buffer.from(stored.buffer))
console.log(`index: ${meta.count} vectors of ${new Set(meta.imageIds).size} artworks of ${new Set(meta.cardIds).size} cards -> public/ai/art${failed.length ? `; ${failed.length} could not be fetched (no cropped artwork online)` : ''}`)
