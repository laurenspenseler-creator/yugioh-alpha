// Estimates the hubs of the artwork index (ADR 0041): cards that win windows of photo after photo
// that they are not on, so that `cardsFromHits` calls them sure only with overwhelming evidence.
//
//   node scripts/art-hubs.mjs <photos folder> [--min-photos 4] [--min-windows 5]
//
// The folder holds, for every test photo, `<key>.json` with the hits the art worker returns for it
// (`recognizeArt(photo, { tuning: { keepHits: true } })`, saved as JSON: `{ "hits": [{ "cardId": ... }] }`;
// the short form `{ "c": ... }` is read too) and one `truth.json` with the cards that are really on each
// photo (`{ "<key>": { "<card id>": copies } }`). A card is a hub when, on at least `--min-photos` photos
// where it is not, it is the closest card of at least `--min-windows` windows. The list is written to
// `public/ai/art/index.json` (`hubs`); `scripts/art-index.mjs` keeps it when the index is rebuilt.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const folder = process.argv[2]
if (!folder || !existsSync(join(folder, 'truth.json'))) {
  console.error('usage: node scripts/art-hubs.mjs <folder with <photo>.json hits and truth.json> [--min-photos 4] [--min-windows 5]')
  process.exit(1)
}
const option = (name, fallback) => {
  const at = process.argv.indexOf(name)
  return at === -1 ? fallback : Number(process.argv[at + 1])
}
const minPhotos = option('--min-photos', 4)
const minWindows = option('--min-windows', 5)

const readJson = (file) => {
  const text = readFileSync(file, 'utf8')
  return JSON.parse(text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text)
}
const truth = readJson(join(folder, 'truth.json'))
const photosWith = new Map()
let photos = 0
for (const file of readdirSync(folder).filter(name => name.endsWith('.json') && name !== 'truth.json')) {
  const key = file.replace(/\.json$/, '')
  if (!truth[key]) {
    continue
  }
  photos += 1
  const wrong = new Map()
  for (const hit of readJson(join(folder, file)).hits ?? []) {
    const cardId = hit.cardId ?? hit.c
    if (!truth[key][cardId]) {
      wrong.set(cardId, (wrong.get(cardId) ?? 0) + 1)
    }
  }
  for (const [cardId, count] of wrong) {
    if (count >= minWindows) {
      photosWith.set(cardId, (photosWith.get(cardId) ?? 0) + 1)
    }
  }
}
const hubs = [...photosWith.entries()].filter(([, count]) => count >= minPhotos).map(([cardId]) => cardId).sort((a, b) => a - b)

const metaFile = join(root, 'public', 'ai', 'art', 'index.json')
const meta = readJson(metaFile)
meta.hubs = hubs
writeFileSync(metaFile, JSON.stringify(meta))
console.log(`${hubs.length} hubs from ${photos} photos (wrong top card of at least ${minWindows} windows on at least ${minPhotos} photos) -> public/ai/art/index.json`)
