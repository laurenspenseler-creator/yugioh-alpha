// The card images on this machine's disk (ADR 0046). The catalog stores YGOPRODeck's image URLs (ADR 0001); the pages
// ask `/api/card-images/<size>/<id>.jpg` instead, and this cache answers from disk, or fetches the image from YGOPRODeck
// once and keeps it. So a card seen once (or warmed up, see `server/plugins/card-image-warmup.ts`) shows without
// internet, and YGOPRODeck, who ask not to be hotlinked, is asked once per image instead of on every page view.
//
// Only the three sizes the catalog knows and numeric file names are accepted: the host is fixed, so the route is no
// open proxy and a path can never leave the cache folder.

import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'

/** Where the catalog's image URLs point to; what follows is the path the cache is asked for. */
export const CARD_IMAGE_UPSTREAM = 'https://images.ygoprodeck.com/images/'

const CARD_IMAGE_PATH = /^(cards|cards_small|cards_cropped)\/\d{1,12}\.jpg$/

/** Smaller than any card scan, larger than any: what is not within is an error page or a trap, not an image. */
const MIN_BYTES = 200
const MAX_BYTES = 5 * 1024 * 1024
/** How long a request waits for YGOPRODeck, and how long the cache then leaves it alone (offline, or it is down). */
const FETCH_TIMEOUT_MS = 6000
const UPSTREAM_PAUSE_MS = 30_000

export interface CardImageOptions {
  /** The cache folder. */
  dir: string
  /** The network, replaceable in a test. */
  fetchImage?: (url: string, signal: AbortSignal) => Promise<Response>
  /** The clock, replaceable in a test. */
  now?: () => number
}

/** `size/id.jpg` as the cache and the route know it, e.g. `cards_small/4003.jpg`. */
export function isCardImagePath(path: string): boolean {
  return CARD_IMAGE_PATH.test(path)
}

/** The cache path of an image URL of the catalog, or null for any other URL. */
export function cardImagePathOfUrl(url: string | null | undefined): string | null {
  if (!url || !url.startsWith(CARD_IMAGE_UPSTREAM)) {
    return null
  }
  const path = url.slice(CARD_IMAGE_UPSTREAM.length)
  return isCardImagePath(path) ? path : null
}

/** The cache folder: next to the database, so it moves with the data (`%APPDATA%\YGO Alpha\data` in the desktop app). */
export function cardImageDir(dbFilePath: string): string {
  return join(dirname(resolve(dbFilePath)), 'card-images')
}

const inFlight = new Map<string, Promise<Buffer | null>>()
let upstreamPausedUntil = 0

/** Forgets that YGOPRODeck did not answer (a test, or the player says they are online again). */
export function resetCardImageUpstream(): void {
  upstreamPausedUntil = 0
  inFlight.clear()
}

async function download(path: string, file: string, options: CardImageOptions): Promise<Buffer | null> {
  const now = options.now ?? Date.now
  if (now() < upstreamPausedUntil) {
    return null
  }
  try {
    const fetchImage = options.fetchImage ?? ((url, signal) => fetch(url, { signal }))
    const response = await fetchImage(`${CARD_IMAGE_UPSTREAM}${path}`, AbortSignal.timeout(FETCH_TIMEOUT_MS))
    if (!response.ok || !(response.headers.get('content-type') ?? '').startsWith('image/')) {
      // The server answered: this image is not there (or not for us), the connection is fine.
      return null
    }
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.length < MIN_BYTES || bytes.length > MAX_BYTES) {
      return null
    }
    await mkdir(dirname(file), { recursive: true })
    // Written beside the target and renamed, so a reader never sees half a file.
    const temporary = `${file}.${randomUUID()}.tmp`
    await writeFile(temporary, bytes)
    await rename(temporary, file)
    return bytes
  }
  catch {
    // No connection (or too slow): do not make every card of a page wait for it again.
    upstreamPausedUntil = now() + UPSTREAM_PAUSE_MS
    return null
  }
}

/**
 * The image at `path` (`cards_small/4003.jpg`): from the disk when it is there, else from YGOPRODeck (and then kept).
 * `null` when the path is not a card image, or the image is neither cached nor reachable.
 */
export async function loadCardImage(path: string, options: CardImageOptions): Promise<Buffer | null> {
  if (!isCardImagePath(path)) {
    return null
  }
  const file = join(options.dir, ...path.split('/'))
  try {
    return await readFile(file)
  }
  catch {
    // Not cached yet.
  }
  // Ten tiles asking for the same scan at once make one request.
  let pending = inFlight.get(path)
  if (!pending) {
    pending = download(path, file, options).finally(() => inFlight.delete(path))
    inFlight.set(path, pending)
  }
  return pending
}

/** Whether the image is on the disk already (the warm-up skips those without reading them). */
export async function isCardImageCached(path: string, dir: string): Promise<boolean> {
  if (!isCardImagePath(path)) {
    return false
  }
  try {
    return (await stat(join(dir, ...path.split('/')))).isFile()
  }
  catch {
    return false
  }
}
