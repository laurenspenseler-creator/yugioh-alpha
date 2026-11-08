// A list added to a deck that exists (`POST /api/decks/:id/cards/import`, the deck editor's "Liste hinzufügen"; tester
// feedback: "Lass mich bei bereits erstellten Decks auch Listen hinzufügen"): the copies join the ones the deck has.
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'
import * as schema from '../../server/db/schema'
import {
  addDeckCards,
  createDeck,
  getDeckDetail,
  MAX_DECK_CARD_QUANTITY,
  MAX_DECK_CREATE_CARDS,
  upsertDeckCard,
  validateDeckAddCardsInput,
} from '../../server/utils/decks'

const DARK_MAGICIAN = 46986414
const STARDUST_DRAGON = 44508094
const RAIGEKI = 12580477

function createTestDb() {
  const sqlite = new Database(':memory:')
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: './server/db/migrations' })
  return db
}

type TestDb = ReturnType<typeof createTestDb>

function seed(db: TestDb) {
  const now = new Date()
  db.insert(schema.user).values([
    { id: 'user-a', name: 'User A', email: 'a@example.com', emailVerified: false, createdAt: now, updatedAt: now },
    { id: 'user-b', name: 'User B', email: 'b@example.com', emailVerified: false, createdAt: now, updatedAt: now },
  ]).run()
  db.insert(schema.catalogCard).values([
    { id: DARK_MAGICIAN, name: 'Dark Magician', type: 'Normal Monster', frameType: 'normal', desc: 'Wizard.', level: 7, syncedAt: now },
    { id: STARDUST_DRAGON, name: 'Stardust Dragon', type: 'Synchro Monster', frameType: 'synchro', desc: 'Tuner.', level: 8, syncedAt: now },
    { id: RAIGEKI, name: 'Raigeki', type: 'Spell Card', frameType: 'spell', desc: 'Destroy.', syncedAt: now },
  ]).run()
}

function quantityIn(db: TestDb, deckId: string, section: 'main' | 'extra' | 'side', cardId: number) {
  return getDeckDetail(db, 'user-a', deckId).sections[section].find(row => row.catalogCardId === cardId)?.quantity
}

describe('validateDeckAddCardsInput', () => {
  it('takes the cards of the list, snake_case or camelCase', () => {
    expect(validateDeckAddCardsInput({ cards: [{ catalog_card_id: DARK_MAGICIAN, section: 'main', quantity: 3 }] }))
      .toEqual([{ catalogCardId: DARK_MAGICIAN, section: 'main', quantity: 3 }])
    expect(validateDeckAddCardsInput({ cards: [{ catalogCardId: String(STARDUST_DRAGON), section: 'extra', quantity: '1' }] }))
      .toEqual([{ catalogCardId: STARDUST_DRAGON, section: 'extra', quantity: 1 }])
  })

  it('rejects a body without cards, an empty list, too many entries and a bad entry', () => {
    const bad = (body: unknown) => expect(() => validateDeckAddCardsInput(body)).toThrow(expect.objectContaining({ statusCode: 400 }))

    bad(undefined)
    bad({})
    bad({ cards: [] })
    bad({ cards: 'nope' })
    bad({ cards: Array.from({ length: MAX_DECK_CREATE_CARDS + 1 }, () => ({ catalog_card_id: DARK_MAGICIAN, section: 'main', quantity: 1 })) })
    bad({ cards: [{ catalog_card_id: DARK_MAGICIAN, section: 'main', quantity: 0 }] })
    bad({ cards: [{ catalog_card_id: DARK_MAGICIAN, section: 'graveyard', quantity: 1 }] })
    bad({ cards: [{ section: 'main', quantity: 1 }] })
  })
})

describe('addDeckCards', () => {
  let db: TestDb

  beforeEach(() => {
    db = createTestDb()
    seed(db)
  })

  it('adds the cards of the list to an empty deck, in their sections', () => {
    const deck = createDeck(db, 'user-a', { name: 'Deck', description: null })

    const detail = addDeckCards(db, 'user-a', deck.id, [
      { catalogCardId: DARK_MAGICIAN, section: 'main', quantity: 3 },
      { catalogCardId: STARDUST_DRAGON, section: 'extra', quantity: 1 },
      { catalogCardId: RAIGEKI, section: 'side', quantity: 2 },
    ])

    expect(detail.counts).toMatchObject({ main: 3, extra: 1, side: 2 })
  })

  it('brings its copies to the ones the deck already has, and leaves the other cards alone', () => {
    const deck = createDeck(db, 'user-a', { name: 'Deck', description: null })
    upsertDeckCard(db, 'user-a', deck.id, { catalogCardId: DARK_MAGICIAN, section: 'main', quantity: 2 })
    upsertDeckCard(db, 'user-a', deck.id, { catalogCardId: RAIGEKI, section: 'main', quantity: 1 })

    addDeckCards(db, 'user-a', deck.id, [
      { catalogCardId: DARK_MAGICIAN, section: 'main', quantity: 1 },
      { catalogCardId: DARK_MAGICIAN, section: 'side', quantity: 1 },
    ])

    expect(quantityIn(db, deck.id, 'main', DARK_MAGICIAN)).toBe(3)
    expect(quantityIn(db, deck.id, 'side', DARK_MAGICIAN)).toBe(1)
    expect(quantityIn(db, deck.id, 'main', RAIGEKI)).toBe(1)
  })

  it('sums entries for the same card and section', () => {
    const deck = createDeck(db, 'user-a', { name: 'Deck', description: null })

    addDeckCards(db, 'user-a', deck.id, [
      { catalogCardId: DARK_MAGICIAN, section: 'main', quantity: 2 },
      { catalogCardId: DARK_MAGICIAN, section: 'main', quantity: 1 },
    ])

    expect(getDeckDetail(db, 'user-a', deck.id).sections.main).toHaveLength(1)
    expect(quantityIn(db, deck.id, 'main', DARK_MAGICIAN)).toBe(3)
  })

  it('writes all of it or none: a card that does not fit leaves the deck as it was', () => {
    const deck = createDeck(db, 'user-a', { name: 'Deck', description: null })
    upsertDeckCard(db, 'user-a', deck.id, { catalogCardId: DARK_MAGICIAN, section: 'main', quantity: 1 })

    // An Extra Deck monster does not belong in Main; the first card of the list is fine.
    expect(() => addDeckCards(db, 'user-a', deck.id, [
      { catalogCardId: DARK_MAGICIAN, section: 'main', quantity: 2 },
      { catalogCardId: STARDUST_DRAGON, section: 'main', quantity: 1 },
    ])).toThrow(expect.objectContaining({ statusCode: 400 }))
    expect(() => addDeckCards(db, 'user-a', deck.id, [
      { catalogCardId: DARK_MAGICIAN, section: 'main', quantity: 2 },
      { catalogCardId: 999999, section: 'main', quantity: 1 },
    ])).toThrow(expect.objectContaining({ statusCode: 400 }))

    expect(quantityIn(db, deck.id, 'main', DARK_MAGICIAN)).toBe(1)
    expect(getDeckDetail(db, 'user-a', deck.id).counts).toMatchObject({ main: 1, extra: 0, side: 0 })
  })

  it('rejects a result above the row cap, like adding the copies one by one, and leaves the deck as it was', () => {
    const deck = createDeck(db, 'user-a', { name: 'Deck', description: null })
    upsertDeckCard(db, 'user-a', deck.id, { catalogCardId: DARK_MAGICIAN, section: 'main', quantity: MAX_DECK_CARD_QUANTITY })

    expect(() => addDeckCards(db, 'user-a', deck.id, [
      { catalogCardId: RAIGEKI, section: 'main', quantity: 1 },
      { catalogCardId: DARK_MAGICIAN, section: 'main', quantity: 1 },
    ])).toThrow(expect.objectContaining({
      statusCode: 400,
      data: { code: 'quantity_too_large', params: { max: MAX_DECK_CARD_QUANTITY } },
    }))

    expect(quantityIn(db, deck.id, 'main', DARK_MAGICIAN)).toBe(MAX_DECK_CARD_QUANTITY)
    expect(quantityIn(db, deck.id, 'main', RAIGEKI)).toBeUndefined()
  })

  it('only works on the deck of the caller', () => {
    const deck = createDeck(db, 'user-a', { name: 'Deck', description: null })

    expect(() => addDeckCards(db, 'user-b', deck.id, [{ catalogCardId: DARK_MAGICIAN, section: 'main', quantity: 1 }]))
      .toThrow(expect.objectContaining({ statusCode: 404, data: { code: 'deck_not_found' } }))
    expect(getDeckDetail(db, 'user-a', deck.id).counts.main).toBe(0)
  })

  it('moves the deck to the top of "recently changed"', () => {
    const deck = createDeck(db, 'user-a', { name: 'Deck', description: null })
    const before = getDeckDetail(db, 'user-a', deck.id).updatedAt.getTime()

    const detail = addDeckCards(db, 'user-a', deck.id, [{ catalogCardId: DARK_MAGICIAN, section: 'main', quantity: 1 }])

    expect(detail.updatedAt.getTime()).toBeGreaterThanOrEqual(before)
  })
})
