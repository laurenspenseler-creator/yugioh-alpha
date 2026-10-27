// Builds the index of catalog artworks that recognizes cards on photos (ADR 0041):
//
//   node scripts/art-index.mjs            add the artworks the index does not have yet (all of them on a first run)
//   node scripts/art-index.mjs --limit 50 stop after 50 new artworks (to try it)
//
// The cropped artwork of every card in the catalog (`catalog_card_image`) is downloaded from
// YGOPRODeck, turned into two vectors of 384 numbers (the class token and the mean of the patch
// tokens) by the same vision model the browser uses (DINOv2-small, 8-bit), and stored in
// `public/ai/art/index.json` + `index.bin` (about 11 MB; the format is described in
// shared/card-art.ts; the file is committed). Nothing but the vectors is kept, so a rerun after a
// catalog sync only fetches the new cards. A first run downloads about 2.5 GB and takes an hour.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { AutoModel, RawImage, Tensor } from '@huggingface/transformers'
import { ART_DIMENSION, ART_PARTS, ART_VECTOR, artVectorFromTokens, quantizeArtVector } from '../shared/card-art.ts'

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

// What the index already has: the vectors stay as they are (int8 and their scale).
const known = new Map()
const metaFile = join(outDir, 'index.json')
const binFile = join(outDir, 'index.bin')
if (existsSync(metaFile) && existsSync(binFile)) {
  const meta = JSON.parse(readFileSync(metaFile, 'utf8'))
  // An index of an older format is rebuilt from scratch.
  if (meta.version === 2) {
    const binary = readFileSync(binFile)
    const scaleBytes = meta.count * ART_PARTS * 4
    const scales = new Float32Array(binary.buffer.slice(binary.byteOffset, binary.byteOffset + scaleBytes))
    const values = new Int8Array(binary.buffer.slice(binary.byteOffset + scaleBytes, binary.byteOffset + scaleBytes + meta.count * ART_VECTOR))
    meta.imageIds.forEach((imageId, i) => known.set(imageId, { cardId: meta.cardIds[i], scales: [...scales.slice(i * ART_PARTS, (i + 1) * ART_PARTS)], values: values.slice(i * ART_VECTOR, (i + 1) * ART_VECTOR) }))
  }
}

const todo = rows.filter(row => !known.has(row.imageId)).slice(0, limit)
console.log(`${rows.length} artworks in the catalog, ${known.size} in the index, ${todo.length} to add`)

const failed = []
if (todo.length > 0) {
  const model = await AutoModel.from_pretrained(MODEL, { dtype: 'q8' })

  const pixels = async (row) => {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        const response = await fetch(row.url)
        if (!response.ok) {
          throw new Error(String(response.status))
        }
        const image = (await RawImage.fromBlob(await response.blob())).rgb()
        const resized = await image.resize(SIZE, SIZE)
        const data = new Float32Array(3 * SIZE * SIZE)
        const plane = SIZE * SIZE
        for (let i = 0; i < plane; i += 1) {
          for (let c = 0; c < 3; c += 1) {
            data[c * plane + i] = (resized.data[i * 3 + c] / 255 - MEAN[c]) / STD[c]
          }
        }
        return data
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
    // Downloads run side by side; the model gets them eight at a time.
    const chunk = todo.slice(at, at + BATCH * DOWNLOADS_AT_ONCE)
    const decoded = await Promise.all(chunk.map(pixels))
    const ready = chunk.map((row, i) => ({ row, data: decoded[i] })).filter(entry => entry.data)
    for (let b = 0; b < ready.length; b += BATCH) {
      const group = ready.slice(b, b + BATCH)
      const input = new Float32Array(group.length * 3 * SIZE * SIZE)
      group.forEach((entry, i) => input.set(entry.data, i * 3 * SIZE * SIZE))
      const { last_hidden_state: hidden } = await model({ pixel_values: new Tensor('float32', input, [group.length, 3, SIZE, SIZE]) })
      const tokens = hidden.dims[1]
      group.forEach((entry, i) => {
        const { scales, values } = quantizeArtVector(artVectorFromTokens(hidden.data, i * tokens * ART_DIMENSION, tokens))
        known.set(entry.row.imageId, { cardId: entry.row.cardId, scales, values })
      })
    }
    console.log(`${Math.min(at + chunk.length, todo.length)}/${todo.length}, ${Math.round((Date.now() - started) / 1000)} s`)
  }
}

// Only artworks of cards that are still in the catalog stay; the order is the catalog's.
const current = new Set(rows.map(row => row.imageId))
const imageIds = [...known.keys()].filter(imageId => current.has(imageId)).sort((a, b) => a - b)
const scales = new Float32Array(imageIds.length * ART_PARTS)
const values = new Int8Array(imageIds.length * ART_VECTOR)
imageIds.forEach((imageId, i) => {
  const entry = known.get(imageId)
  scales.set(entry.scales, i * ART_PARTS)
  values.set(entry.values, i * ART_VECTOR)
})
const meta = { version: 2, model: MODEL, dimension: ART_DIMENSION, parts: ART_PARTS, count: imageIds.length, cardIds: imageIds.map(imageId => known.get(imageId).cardId), imageIds }
mkdirSync(outDir, { recursive: true })
writeFileSync(metaFile, JSON.stringify(meta))
writeFileSync(binFile, Buffer.concat([Buffer.from(scales.buffer), Buffer.from(values.buffer)]))
console.log(`index: ${meta.count} artworks of ${new Set(meta.cardIds).size} cards -> public/ai/art${failed.length ? `; ${failed.length} could not be fetched (no cropped artwork online)` : ''}`)
