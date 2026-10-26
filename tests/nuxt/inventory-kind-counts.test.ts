// The chips beside the inventory's filters: copies per card kind, per scope.
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'
import * as schema from '../../server/db/schema'
import { loadInventoryKindCounts } from '../../server/utils/inventory-kind-counts'
import { inventoryKindBreakdown } from '../../shared/deck-breakdown'
import { UNASSIGNED_COLLECTION_ID } from '../../shared/inventory'

function createTestDb() {
  const db = drizzle(new Database(':memory:'), { schema })
  migrate(db, { migrationsFolder: './server/db/migrations' })
  return db
}

const now = new Date()

const CARDS = [
  { id: 1, name: 'Kuriboh', type: 'Effect Monster', frameType: 'effect' },
  { id: 2, name: 'Dark Magician', type: 'Normal Monster', frameType: 'normal' },
  { id: 3, name: 'Raigeki', type: 'Spell Card', frameType: 'spell' },
  { id: 4, name: 'Mirror Force', type: 'Trap Card', frameType: 'trap' },
  { id: 5, name: 'Cyber Dragon', type: 'Effect Monster', frameType: 'effect' },
  { id: 6, name: 'Thousand-Eyes Restrict', type: 'Fusion Monster', frameType: 'fusion' },
  { id: 7, name: 'Speed Duel Skill', type: 'Skill Card', frameType: 'skill' },
  { id: 8, name: 'Buntäugiger Pendeldrache', type: 'Pendulum Effect Monster', frameType: 'effect_pendulum' },
  { id: 9, name: 'Odd-Eyes Rebellion Xyz', type: 'XYZ Pendulum Effect Monster', frameType: 'xyz_pendulum' },
]

describe('loadInventoryKindCounts', () => {
  let db: ReturnType<typeof createTestDb>

  beforeEach(() => {
    db = createTestDb()
    db.insert(schema.user).values(['user-a', 'user-b'].map(id => ({
      id, name: id, email: `${id}@example.com`, emailVerified: false, createdAt: now, updatedAt: now,
    }))).run()
    db.insert(schema.catalogCard).values(CARDS.map(card => ({ ...card, desc: '', syncedAt: now }))).run()
    db.insert(schema.collection).values([
      { id: 'box-1', userId: 'user-a', name: 'Box 1', createdAt: now, updatedAt: now },
      { id: 'box-b', userId: 'user-b', name: 'Box B', createdAt: now, updatedAt: now },
    ]).run()

    const owned = (id: string, userId: string, catalogCardId: number, quantity: number, collectionId: string | null) => ({
      id, userId, catalogCardId, quantity, collectionId, createdAt: now, updatedAt: now,
    })
    db.insert(schema.ownedCard).values([
      owned('o1', 'user-a', 1, 3, 'box-1'), // Kuriboh ×3 in Box 1
      owned('o2', 'user-a', 5, 2, null), // Cyber Dragon ×2, no collection
      owned('o3', 'user-a', 2, 1, 'box-1'),
      owned('o4', 'user-a', 3, 4, null), // Raigeki ×4
      owned('o5', 'user-a', 4, 2, 'box-1'),
      owned('o6', 'user-a', 6, 1, null),
      owned('o7', 'user-a', 7, 1, null), // a skill: counted as "other"
      owned('o8', 'user-a', 8, 2, null), // a Pendulum Effect Monster ×2: "Effekt" and "Pendel"
      owned('o9', 'user-a', 9, 1, 'box-1'), // a Pendulum Xyz: "Xyz" and "Pendel"
      owned('x1', 'user-b', 3, 9, 'box-b'), // another user's copies never count
    ]).run()
  })

  it('counts the copies of the whole inventory per kind, in chip order, with Pendel between Xyz and Link', () => {
    const result = loadInventoryKindCounts(db, 'user-a')

    expect(result.kinds).toEqual([
      { kind: 'normal', count: 1 },
      { kind: 'effect', count: 7 },
      { kind: 'spell', count: 4 },
      { kind: 'trap', count: 2 },
      { kind: 'fusion', count: 1 },
      { kind: 'xyz', count: 1 },
      { kind: 'pendulum', count: 3 },
      { kind: 'other', count: 1 },
    ])
    // Every copy once: the 3 Pendulum copies are already in "Effekt" and "Xyz".
    expect(result.total).toBe(17)
  })

  it('scopes to one collection and to the copies without one', () => {
    expect(loadInventoryKindCounts(db, 'user-a', 'box-1')).toEqual({
      kinds: [{ kind: 'normal', count: 1 }, { kind: 'effect', count: 3 }, { kind: 'trap', count: 2 }, { kind: 'xyz', count: 1 }, { kind: 'pendulum', count: 1 }],
      total: 7,
    })
    expect(loadInventoryKindCounts(db, 'user-a', UNASSIGNED_COLLECTION_ID)).toEqual({
      kinds: [{ kind: 'effect', count: 4 }, { kind: 'spell', count: 4 }, { kind: 'fusion', count: 1 }, { kind: 'pendulum', count: 2 }, { kind: 'other', count: 1 }],
      total: 10,
    })
  })

  it('counts nothing for a collection of someone else, or one that does not exist', () => {
    expect(loadInventoryKindCounts(db, 'user-a', 'box-b')).toEqual({ kinds: [], total: 0 })
    expect(loadInventoryKindCounts(db, 'user-a', 'no-such-box')).toEqual({ kinds: [], total: 0 })
  })

  it('has nothing to show for an empty inventory', () => {
    expect(loadInventoryKindCounts(db, 'nobody')).toEqual({ kinds: [], total: 0 })
  })
})

describe('inventoryKindBreakdown', () => {
  it('puts Pendel right after Xyz, before Link, and leaves it out without a Pendulum card', () => {
    const pendulum = { type: 'Pendulum Normal Monster', frameType: 'normal_pendulum', quantity: 2 }
    const link = { type: 'Link Monster', frameType: 'link', quantity: 1 }
    const xyz = { type: 'XYZ Monster', frameType: 'xyz', quantity: 4 }

    expect(inventoryKindBreakdown([link, xyz, pendulum]).map(entry => entry.kind)).toEqual(['normal', 'xyz', 'pendulum', 'link'])
    expect(inventoryKindBreakdown([link, xyz]).map(entry => entry.kind)).toEqual(['xyz', 'link'])
    expect(inventoryKindBreakdown([pendulum])).toEqual([{ kind: 'normal', count: 2 }, { kind: 'pendulum', count: 2 }])
  })
})
