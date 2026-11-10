import { cardImageDir, loadCardImage } from '../../utils/card-image-cache'

/**
 * `GET /api/card-images/<size>/<id>.jpg` (size: cards, cards_small, cards_cropped): a card scan from the cache on this
 * machine's disk, fetched from YGOPRODeck the first time (ADR 0046). Public like the images it stands in for: it gives
 * out nothing but a card's picture, and a shared deck page shows those to people who are not signed in.
 */
export default defineEventHandler(async (event) => {
  const path = getRouterParam(event, 'path') ?? ''
  const image = await loadCardImage(path, { dir: cardImageDir(useRuntimeConfig().dbFilePath || './data/app.db') })
  if (!image) {
    // Not cached and not reachable (offline), or not a card image at all: the page shows its card back.
    setHeader(event, 'cache-control', 'no-store')
    throw createError({ statusCode: 404, statusMessage: 'Not Found' })
  }
  setHeader(event, 'content-type', 'image/jpeg')
  // A scan never changes under its id.
  setHeader(event, 'cache-control', 'public, max-age=2592000, immutable')
  return image
})
