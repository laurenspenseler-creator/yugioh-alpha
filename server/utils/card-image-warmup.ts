// Fetches the card images a player will want without internet before they ask for them (ADR 0046): the small scan of
// every card in their inventories, decks and wish lists that is not in the image cache yet. Everything else is cached
// the first time it is looked at (`loadCardImage`), so this only closes the gap for the cards that matter most.

import { sql } from 'drizzle-orm'
import type { useDb } from '../db'
import { catalogCard, deckCard, ownedCard, wishlistItem } from '../db/schema'
import { primaryImageUrlSql } from './card-image-sql'
import { cardImagePathOfUrl, isCardImageCached, loadCardImage } from './card-image-cache'
import type { CardImageOptions } from './card-image-cache'

type Db = ReturnType<typeof useDb>

/** Images fetched at the same time: friendly to YGOPRODeck, and a few hundred cards take a minute or so. */
const CONCURRENCY = 3
/** After this many images in a row that could not be fetched, the connection is taken to be gone and the run ends. */
const GIVE_UP_AFTER = 5

export interface WarmupResult {
  /** The images the players' cards have. */
  wanted: number
  /** Fetched and stored now. */
  fetched: number
  /** Already in the cache. */
  cached: number
  /** Could not be fetched (offline, or YGOPRODeck does not have them). */
  failed: number
}

/** The small scan paths (`cards_small/4003.jpg`) of the cards in any inventory, deck or wish list, each once. */
export function wantedCardImagePaths(db: Db): string[] {
  const rows = db
    .select({ url: primaryImageUrlSql('imageUrlSmall') })
    .from(catalogCard)
    .where(sql`${catalogCard.id} in (
      select ${ownedCard.catalogCardId} from ${ownedCard}
      union select ${deckCard.catalogCardId} from ${deckCard}
      union select ${wishlistItem.catalogCardId} from ${wishlistItem}
    )`)
    .all()
  return [...new Set(rows.flatMap(row => cardImagePathOfUrl(row.url) ?? []))]
}

export async function warmUpCardImages(db: Db, options: CardImageOptions): Promise<WarmupResult> {
  const paths = wantedCardImagePaths(db)
  const result: WarmupResult = { wanted: paths.length, fetched: 0, cached: 0, failed: 0 }
  const queue = [...paths]
  let failedInARow = 0

  async function worker() {
    for (let path = queue.shift(); path !== undefined; path = queue.shift()) {
      if (failedInARow >= GIVE_UP_AFTER) {
        return
      }
      if (await isCardImageCached(path, options.dir)) {
        result.cached++
        continue
      }
      if (await loadCardImage(path, options)) {
        result.fetched++
        failedInARow = 0
      }
      else {
        result.failed++
        failedInARow++
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker))
  return result
}
