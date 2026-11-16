// The rows of the inventory export (ADR 0051): the list's search, facets and scope, with every page, ordered like a document.
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'
import * as schema from '../../server/db/schema'
import { UNASSIGNED_COLLECTION_ID } from '../../shared/inventory'
import { exportOwnedCards, INVENTORY_EXPORT_MAX_ROWS, listOwnedCards, parseInventoryListQuery } from '../../server/utils/inventory'
import { seedGermanNames } from './fixtures/german-names'

function createTestDb() {
  const sqlite = new Database(':memory:')
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: './server/db/migrations' })
  return db
}

type TestDb = ReturnType<typeof createTestDb>

const now = new Date()

function seed(db: TestDb) {
  for (const id of ['user-a', 'user-b']) {
    db.insert(schema.user).values({ id, name: id, email: `${id}@example.com`, emailVerified: false, createdAt: now, updatedAt: now }).run()
  }

  db.insert(schema.catalogCard).values([
    { id: 46986414, name: 'Dark Magician', type: 'Normal Monster', attribute: 'DARK', race: 'Spellcaster', level: 7, atk: 2500, def: 2100, desc: 'The ultimate wizard.', syncedAt: now },
    { id: 55144522, name: 'Pot of Greed', type: 'Spell Card', race: 'Normal', desc: 'Draw two cards.', syncedAt: now },
    { id: 40640057, name: 'Kuriboh', type: 'Effect Monster', attribute: 'DARK', race: 'Fiend', level: 1, atk: 300, def: 200, desc: 'Discard.', syncedAt: now },
  ]).run()

  db.insert(schema.collection).values([
    { id: 'col-box', userId: 'user-a', name: 'Box 1', createdAt: now, updatedAt: now },
    { id: 'col-binder', userId: 'user-a', name: 'binder A', createdAt: now, updatedAt: now },
  ]).run()

  const owned = (id: string, catalogCardId: number, collectionId: string | null, quantity: number, note: string | null = null, userId = 'user-a') =>
    ({ id, userId, catalogCardId, collectionId, quantity, note, createdAt: now, updatedAt: now })
  db.insert(schema.ownedCard).values([
    owned('o1', 46986414, 'col-box', 2),
    owned('o2', 46986414, null, 1),
    owned('o3', 55144522, 'col-binder', 1),
    owned('o4', 40640057, 'col-binder', 3, 'Aus dem Starterdeck'),
    // Another user's copy never shows up.
    owned('o5', 55144522, null, 9, null, 'user-b'),
  ]).run()
}

describe('exportOwnedCards', () => {
  let db: TestDb

  beforeEach(() => {
    db = createTestDb()
    seed(db)
  })

  const lines = (result: ReturnType<typeof exportOwnedCards>) =>
    result.items.map(item => `${item.collectionName ?? '-'}: ${item.quantity}x ${item.name}`)

  it('lists every copy of the user, by collection (the copies without one last), then by name', () => {
    expect(lines(exportOwnedCards(db, 'user-a'))).toEqual([
      'binder A: 3x Kuriboh',
      'binder A: 1x Pot of Greed',
      'Box 1: 2x Dark Magician',
      '-: 1x Dark Magician',
    ])
  })

  it('carries what the files show: the card data in its stored values, the collection and the note', () => {
    const result = exportOwnedCards(db, 'user-a')

    expect(result.truncated).toBe(false)
    expect(result.items[0]).toEqual({
      catalogCardId: 40640057,
      collectionId: 'col-binder',
      collectionName: 'binder A',
      quantity: 3,
      note: 'Aus dem Starterdeck',
      name: 'Kuriboh',
      nameDe: null,
      type: 'Effect Monster',
      attribute: 'DARK',
      race: 'Fiend',
      level: 1,
      linkval: null,
      atk: 300,
      def: 200,
    })
    expect(result.items[3]).toMatchObject({ collectionId: null, collectionName: null, quantity: 1 })
  })

  it('orders the cards of a collection by their name in the card language', () => {
    seedGermanNames(db, { 55144522: 'Aaa Topf', 40640057: 'Zzz Kuriboh' })

    expect(lines(exportOwnedCards(db, 'user-a', { cardLocale: 'de' })).slice(0, 2)).toEqual([
      'binder A: 1x Pot of Greed',
      'binder A: 3x Kuriboh',
    ])
    expect(exportOwnedCards(db, 'user-a', { cardLocale: 'de' }).items[0]!.nameDe).toBe('Aaa Topf')
    expect(lines(exportOwnedCards(db, 'user-a', { cardLocale: 'en' })).slice(0, 2)).toEqual([
      'binder A: 3x Kuriboh',
      'binder A: 1x Pot of Greed',
    ])
  })

  it('takes the list\'s search and facets, and its scope: one collection, or the copies without one', () => {
    expect(lines(exportOwnedCards(db, 'user-a', { q: 'dark' }))).toEqual(['Box 1: 2x Dark Magician', '-: 1x Dark Magician'])
    expect(lines(exportOwnedCards(db, 'user-a', { kind: ['spell'] }))).toEqual(['binder A: 1x Pot of Greed'])
    expect(lines(exportOwnedCards(db, 'user-a', { collectionId: 'col-box' }))).toEqual(['Box 1: 2x Dark Magician'])
    expect(lines(exportOwnedCards(db, 'user-a', { collectionId: UNASSIGNED_COLLECTION_ID }))).toEqual(['-: 1x Dark Magician'])
    expect(lines(exportOwnedCards(db, 'user-a', { attribute: ['DARK'], level: [1] }))).toEqual(['binder A: 3x Kuriboh'])
  })

  it('holds the same copies as the list does, whatever the page size', () => {
    const query = parseInventoryListQuery({ attribute: 'DARK', pageSize: '1', page: '2', sort: 'atk' })
    const exported = exportOwnedCards(db, 'user-a', query)
    const listed = listOwnedCards(db, 'user-a', { ...query, page: 1, pageSize: 100 })

    expect(exported.items.map(item => item.quantity).sort()).toEqual(listed.items.map(item => item.quantity).sort())
    expect(exported.items).toHaveLength(listed.total)
  })

  it('has nothing for a user without cards', () => {
    expect(exportOwnedCards(db, 'nobody')).toEqual({ items: [], truncated: false })
  })

  it('is not cut off at a page: 130 cards come in one piece', () => {
    db.insert(schema.catalogCard).values(Array.from({ length: 130 }, (_, index) => ({
      id: 1000 + index, name: `Card ${String(index).padStart(3, '0')}`, type: 'Normal Monster', desc: '.', syncedAt: now,
    }))).run()
    db.insert(schema.ownedCard).values(Array.from({ length: 130 }, (_, index) => ({
      id: `bulk-${index}`, userId: 'user-b', catalogCardId: 1000 + index, collectionId: null, quantity: 1, note: null, createdAt: now, updatedAt: now,
    }))).run()

    const result = exportOwnedCards(db, 'user-b')
    expect(result.items).toHaveLength(131)
    expect(result.truncated).toBe(false)
    expect(result.items[0]!.name).toBe('Card 000')
  })

  it('stops at the most rows one export carries, and says so', () => {
    expect(INVENTORY_EXPORT_MAX_ROWS).toBe(20000)
    const chunk = 500
    for (let start = 0; start <= INVENTORY_EXPORT_MAX_ROWS; start += chunk) {
      const size = Math.min(chunk, INVENTORY_EXPORT_MAX_ROWS + 1 - start)
      db.insert(schema.catalogCard).values(Array.from({ length: size }, (_, index) => ({
        id: 100000 + start + index, name: `Bulk ${start + index}`, type: 'Normal Monster', desc: '.', syncedAt: now,
      }))).run()
      db.insert(schema.ownedCard).values(Array.from({ length: size }, (_, index) => ({
        id: `many-${start + index}`, userId: 'user-b', catalogCardId: 100000 + start + index, collectionId: null, quantity: 1, note: null, createdAt: now, updatedAt: now,
      }))).run()
    }

    const result = exportOwnedCards(db, 'user-b')
    expect(result.items).toHaveLength(INVENTORY_EXPORT_MAX_ROWS)
    expect(result.truncated).toBe(true)
  }, 60_000)
})
