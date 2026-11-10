// Where a card scan is loaded from (ADR 0046). The catalog holds YGOPRODeck's URLs; the app asks its own server for the
// same file instead (`/api/card-images/<size>/<id>.jpg`), which keeps every scan it has seen on the disk, so the cards
// still have their pictures without internet. Any other URL (a photo, a data: URL, a path already local) stays as it is.

const UPSTREAM = 'https://images.ygoprodeck.com/images/'
const LOCAL = '/api/card-images/'

/** The URL the page loads a card scan from. */
export function cardImageSrc(url: string | null | undefined): string | undefined {
  if (!url) {
    return undefined
  }
  return url.startsWith(UPSTREAM) ? `${LOCAL}${url.slice(UPSTREAM.length)}` : url
}
