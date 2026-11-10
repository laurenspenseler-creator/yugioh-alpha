// The card images on the disk (ADR 0046): the cache the pages load the scans from, and the warm-up that fills it for the
// cards of the players.
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as schema from '../../server/db/schema'
import {
  CARD_IMAGE_UPSTREAM,
  cardImageDir,
  cardImagePathOfUrl,
  isCardImagePath,
  loadCardImage,
  resetCardImageUpstream,
} from '../../server/utils/card-image-cache'
import { wantedCardImagePaths, warmUpCardImages } from '../../server/utils/card-image-warmup'
import { cardImageSrc } from '../../app/utils/card-image-url'

type FetchImage = (url: string, signal: AbortSignal) => Promise<Response>

const JPEG = Buffer.alloc(2048, 7)

function imageResponse(bytes: Buffer = JPEG, type = 'image/jpeg', status = 200): Response {
  return new Response(new Uint8Array(bytes), { status, headers: { 'content-type': type } })
}

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ygo-card-images-'))
  resetCardImageUpstream()
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('the paths of the image cache', () => {
  it('accepts the three sizes of YGOPRODeck with a numeric jpg name, and nothing else', () => {
    for (const path of ['cards/4003.jpg', 'cards_small/4003.jpg', 'cards_cropped/46986414.jpg', 'cards_small/1234561.jpg']) {
      expect(isCardImagePath(path), path).toBe(true)
    }
    for (const path of [
      '', 'cards/4003.png', 'cards/abc.jpg', 'cards/4003.jpg/', '/cards/4003.jpg', 'other/4003.jpg',
      '../cards/4003.jpg', 'cards/../4003.jpg', 'cards/..%2F4003.jpg', 'cards\\4003.jpg', 'cards_small/4003.jpg?x=1',
      'cards/1234567890123.jpg',
    ]) {
      expect(isCardImagePath(path), path).toBe(false)
    }
  })

  it('takes the cache path out of an image URL of the catalog, and out of no other URL', () => {
    expect(cardImagePathOfUrl(`${CARD_IMAGE_UPSTREAM}cards_small/4003.jpg`)).toBe('cards_small/4003.jpg')
    expect(cardImagePathOfUrl('https://evil.example/images/cards_small/4003.jpg')).toBeNull()
    expect(cardImagePathOfUrl(`${CARD_IMAGE_UPSTREAM}cards_small/../../x.jpg`)).toBeNull()
    expect(cardImagePathOfUrl(null)).toBeNull()
  })

  it('keeps the cache next to the database', () => {
    expect(cardImageDir(join(dir, 'data', 'app.db'))).toBe(join(dir, 'data', 'card-images'))
  })
})

describe('the page address of a scan', () => {
  it('goes through the app\'s own cache for the images of YGOPRODeck, and leaves every other source as it is', () => {
    expect(cardImageSrc('https://images.ygoprodeck.com/images/cards_small/4003.jpg')).toBe('/api/card-images/cards_small/4003.jpg')
    expect(cardImageSrc('/api/card-images/cards/4003.jpg')).toBe('/api/card-images/cards/4003.jpg')
    expect(cardImageSrc('https://images.example/bewd.jpg')).toBe('https://images.example/bewd.jpg')
    expect(cardImageSrc('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA')
    expect(cardImageSrc(null)).toBeUndefined()
    expect(cardImageSrc('')).toBeUndefined()
  })
})

describe('loadCardImage', () => {
  it('fetches an image from YGOPRODeck once and then answers from the disk, also without internet', async () => {
    const fetchImage = vi.fn<FetchImage>(async () => imageResponse())

    const first = await loadCardImage('cards_small/4003.jpg', { dir, fetchImage })
    expect(first?.equals(JPEG)).toBe(true)
    expect(fetchImage).toHaveBeenCalledTimes(1)
    expect(fetchImage.mock.calls[0]![0]).toBe('https://images.ygoprodeck.com/images/cards_small/4003.jpg')
    expect((await readFile(join(dir, 'cards_small', '4003.jpg'))).equals(JPEG)).toBe(true)

    // Offline now: the network is gone, the picture is not.
    const offline = vi.fn<FetchImage>(async () => {
      throw new Error('getaddrinfo ENOTFOUND images.ygoprodeck.com')
    })
    const again = await loadCardImage('cards_small/4003.jpg', { dir, fetchImage: offline })
    expect(again?.equals(JPEG)).toBe(true)
    expect(offline).not.toHaveBeenCalled()
  })

  it('makes one request for the same scan asked for ten times at once', async () => {
    const fetchImage = vi.fn<FetchImage>(async () => imageResponse())
    const all = await Promise.all(Array.from({ length: 10 }, () => loadCardImage('cards/4003.jpg', { dir, fetchImage })))
    expect(all.every(image => image?.equals(JPEG))).toBe(true)
    expect(fetchImage).toHaveBeenCalledTimes(1)
  })

  it('does not ask YGOPRODeck for anything that is not a card image', async () => {
    const fetchImage = vi.fn<FetchImage>(async () => imageResponse())
    for (const path of ['../app.db', 'cards/../../app.db', 'cards/abc.jpg', 'secret.txt', '']) {
      expect(await loadCardImage(path, { dir, fetchImage }), path).toBeNull()
    }
    expect(fetchImage).not.toHaveBeenCalled()
    expect(await readdir(dir)).toEqual([])
  })

  it('has nothing to show when offline and not cached, and leaves the network alone for a while', async () => {
    let clock = 1_000_000
    const fetchImage = vi.fn<FetchImage>(async () => {
      throw new Error('offline')
    })
    const options = { dir, fetchImage, now: () => clock }

    expect(await loadCardImage('cards_small/1.jpg', options)).toBeNull()
    expect(fetchImage).toHaveBeenCalledTimes(1)
    // Twenty tiles of a page do not wait for the timeout twenty times.
    expect(await loadCardImage('cards_small/2.jpg', options)).toBeNull()
    expect(fetchImage).toHaveBeenCalledTimes(1)

    // Later it asks again, and the connection is back.
    clock += 31_000
    fetchImage.mockImplementation(async () => imageResponse())
    expect((await loadCardImage('cards_small/3.jpg', options))?.equals(JPEG)).toBe(true)
    expect(fetchImage).toHaveBeenCalledTimes(2)
  })

  it('does not keep what is not a picture: an error page, a text, a tiny or a huge file', async () => {
    const options = (response: () => Response) => ({ dir, fetchImage: async () => response() })
    expect(await loadCardImage('cards/10.jpg', options(() => imageResponse(JPEG, 'image/jpeg', 404)))).toBeNull()
    expect(await loadCardImage('cards/11.jpg', options(() => imageResponse(JPEG, 'text/html')))).toBeNull()
    expect(await loadCardImage('cards/12.jpg', options(() => imageResponse(Buffer.alloc(20), 'image/jpeg')))).toBeNull()
    expect(await loadCardImage('cards/13.jpg', options(() => imageResponse(Buffer.alloc(6 * 1024 * 1024), 'image/jpeg')))).toBeNull()
    expect(await readdir(dir)).toEqual([])
  })

  it('does not take a missing image for a lost connection', async () => {
    const fetchImage = vi.fn<FetchImage>(async () => imageResponse(JPEG, 'text/html', 404))
    expect(await loadCardImage('cards/10.jpg', { dir, fetchImage })).toBeNull()
    fetchImage.mockImplementation(async () => imageResponse())
    expect((await loadCardImage('cards/11.jpg', { dir, fetchImage }))?.equals(JPEG)).toBe(true)
  })

  it('leaves no half-written file behind', async () => {
    await loadCardImage('cards_small/4003.jpg', { dir, fetchImage: async () => imageResponse() })
    expect(await readdir(join(dir, 'cards_small'))).toEqual(['4003.jpg'])
  })
})

describe('the warm-up of the images of a player\'s own cards', () => {
  const now = new Date()
  let db: ReturnType<typeof createDb>

  function createDb() {
    const database = drizzle(new Database(':memory:'), { schema })
    migrate(database, { migrationsFolder: './server/db/migrations' })
    return database
  }

  beforeEach(() => {
    db = createDb()
    db.insert(schema.user).values({ id: 'u1', name: 'U', email: 'u@example.com', emailVerified: false, createdAt: now, updatedAt: now }).run()
    db.insert(schema.catalogCard).values([1, 2, 3, 4].map(id => ({ id, name: `Card ${id}`, type: 'Effect Monster', desc: '', syncedAt: now }))).run()
    db.insert(schema.catalogCardImage).values([
      // Card 1 has its main art and an alternate one: only the main art is wanted.
      { id: 1, cardId: 1, imageUrl: `${CARD_IMAGE_UPSTREAM}cards/1.jpg`, imageUrlSmall: `${CARD_IMAGE_UPSTREAM}cards_small/1.jpg`, imageUrlCropped: null },
      { id: 11, cardId: 1, imageUrl: `${CARD_IMAGE_UPSTREAM}cards/11.jpg`, imageUrlSmall: `${CARD_IMAGE_UPSTREAM}cards_small/11.jpg`, imageUrlCropped: null },
      { id: 2, cardId: 2, imageUrl: `${CARD_IMAGE_UPSTREAM}cards/2.jpg`, imageUrlSmall: `${CARD_IMAGE_UPSTREAM}cards_small/2.jpg`, imageUrlCropped: null },
      { id: 3, cardId: 3, imageUrl: `${CARD_IMAGE_UPSTREAM}cards/3.jpg`, imageUrlSmall: `${CARD_IMAGE_UPSTREAM}cards_small/3.jpg`, imageUrlCropped: null },
      { id: 4, cardId: 4, imageUrl: `${CARD_IMAGE_UPSTREAM}cards/4.jpg`, imageUrlSmall: `${CARD_IMAGE_UPSTREAM}cards_small/4.jpg`, imageUrlCropped: null },
    ]).run()
    db.insert(schema.deck).values({ id: 'd1', userId: 'u1', name: 'Deck', createdAt: now, updatedAt: now }).run()
    db.insert(schema.ownedCard).values({ id: 'o1', userId: 'u1', catalogCardId: 1, quantity: 3, createdAt: now, updatedAt: now }).run()
    db.insert(schema.deckCard).values({ id: 'dc1', deckId: 'd1', catalogCardId: 2, section: 'main', quantity: 1, createdAt: now, updatedAt: now }).run()
    db.insert(schema.wishlistItem).values({ id: 'w1', userId: 'u1', catalogCardId: 3, quantity: 1, createdAt: now, updatedAt: now }).run()
    // Card 4 is in nobody's inventory, deck or wish list.
  })

  it('wants the small main scan of every card in an inventory, a deck or a wish list, and no other', () => {
    expect(wantedCardImagePaths(db).sort()).toEqual(['cards_small/1.jpg', 'cards_small/2.jpg', 'cards_small/3.jpg'])
  })

  it('fetches what is missing and skips what is there', async () => {
    await mkdir(join(dir, 'cards_small'), { recursive: true })
    await writeFile(join(dir, 'cards_small', '2.jpg'), JPEG)
    const fetchImage = vi.fn<FetchImage>(async () => imageResponse())

    const result = await warmUpCardImages(db, { dir, fetchImage })

    expect(result).toEqual({ wanted: 3, fetched: 2, cached: 1, failed: 0 })
    expect(fetchImage.mock.calls.map(call => call[0]).sort()).toEqual([
      'https://images.ygoprodeck.com/images/cards_small/1.jpg',
      'https://images.ygoprodeck.com/images/cards_small/3.jpg',
    ])
    expect((await readdir(join(dir, 'cards_small'))).sort()).toEqual(['1.jpg', '2.jpg', '3.jpg'])
  })

  it('stops by itself when there is no connection', async () => {
    const many = Array.from({ length: 30 }, (_, index) => index + 100)
    db.insert(schema.catalogCard).values(many.map(id => ({ id, name: `Card ${id}`, type: 'Effect Monster', desc: '', syncedAt: now }))).run()
    db.insert(schema.catalogCardImage).values(many.map(id => ({
      id, cardId: id, imageUrl: `${CARD_IMAGE_UPSTREAM}cards/${id}.jpg`, imageUrlSmall: `${CARD_IMAGE_UPSTREAM}cards_small/${id}.jpg`, imageUrlCropped: null,
    }))).run()
    db.insert(schema.wishlistItem).values(many.map(id => ({ id: `w-${id}`, userId: 'u1', catalogCardId: id, quantity: 1, createdAt: now, updatedAt: now }))).run()
    const fetchImage = vi.fn<FetchImage>(async () => {
      throw new Error('offline')
    })

    const result = await warmUpCardImages(db, { dir, fetchImage })

    expect(result.fetched).toBe(0)
    expect(result.wanted).toBe(33)
    // The first failure pauses the network for everyone, the rest are given up on quickly.
    expect(fetchImage.mock.calls.length).toBeLessThan(10)
  })
})
