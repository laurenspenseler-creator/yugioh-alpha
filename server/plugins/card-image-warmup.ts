import { useDb } from '../db'
import { cardImageDir } from '../utils/card-image-cache'
import { warmUpCardImages } from '../utils/card-image-warmup'

/**
 * The desktop app (and anyone who sets `NUXT_CARD_IMAGE_WARMUP=1`) fetches the images of the cards in the player's
 * inventories, decks and wish lists in the background a little after the start, so they show without internet later
 * (ADR 0046). Off by default: a web host, a test run or a CI job has no use for it, and the desktop app is the one place
 * where "no internet" is a normal state.
 */
export default defineNitroPlugin(() => {
  const config = useRuntimeConfig()
  // Nitro turns NUXT_CARD_IMAGE_WARMUP=1 into the number 1 (see the migrate plugin).
  if (String(config.cardImageWarmup) !== '1') {
    return
  }
  const dir = cardImageDir(config.dbFilePath || './data/app.db')
  const timer = setTimeout(() => {
    warmUpCardImages(useDb(), { dir })
      .then(result => console.info(`[card-images] warm-up: ${result.fetched} fetched, ${result.cached} already there, ${result.failed} not available (${result.wanted} wanted)`))
      .catch(error => console.warn('[card-images] warm-up failed', error))
  }, 20_000)
  // The warm-up never keeps the server from stopping.
  timer.unref()
})
