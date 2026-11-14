// The "Zulässigkeit" filter of the catalog and the inventory (tester feedback, round 14): the cards a rule format allows,
// or does not, or allows in a number of copies.
import Database from 'better-sqlite3'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { beforeEach, describe, expect, it } from 'vitest'
import * as schema from '../../server/db/schema'
import { CATALOG_FIXTURE_IDS, seedCatalogFixture } from '../../server/db/fixtures/catalog-fixture'
import { parseCardListQuery } from '../../server/utils/catalog-query'
import { searchCatalog } from '../../server/utils/catalog-search'
import { clearFormatLegalityCache, formatCardLimits, legalityCardIds, parseFormatLegalityQuery } from '../../server/utils/format-legality'
import { listOwnedCards, parseInventoryListQuery } from '../../server/utils/inventory'
import { buildInventorySearchWhere, parseInventorySearchQuery } from '../../server/utils/inventory-search'
import { createRuleFormat, seedBuiltinFormats } from '../../server/utils/rule-formats'
import { DEFAULT_FORMAT_LEGALITY, FORMAT_LEGALITIES, isFormatLegality, legalityMatches } from '../../shared/format-legality'

const ID = CATALOG_FIXTURE_IDS
const now = new Date()

function createTestDb() {
  const db = drizzle(new Database(':memory:'), { schema })
  migrate(db, { migrationsFolder: './server/db/migrations' })
  return db
}

describe('legalityMatches', () => {
  it('reads the copy limit of the rule engine: 0 is not allowed, 1 and 2 are limited, 3 is free', () => {
    const table: Array<[number, string[]]> = [
      [0, ['illegal']],
      [1, ['legal', 'limited']],
      [2, ['legal', 'semi_limited']],
      [3, ['legal', 'unlimited']],
    ]
    for (const [copies, matching] of table) {
      expect(FORMAT_LEGALITIES.filter(legality => legalityMatches(legality, copies)), `${copies} copies`).toEqual(
        FORMAT_LEGALITIES.filter(legality => matching.includes(legality)),
      )
    }
  })

  it('knows its choices, and "legal" is the default', () => {
    expect(DEFAULT_FORMAT_LEGALITY).toBe('legal')
    expect(isFormatLegality('semi_limited')).toBe(true)
    expect(isFormatLegality('banned')).toBe(false)
    expect(isFormatLegality(undefined)).toBe(false)
  })
})

describe('parseFormatLegalityQuery', () => {
  it('has nothing to filter without a format, and takes "legal" for a missing or wrong legality', () => {
    expect(parseFormatLegalityQuery(undefined, 'legal')).toEqual({})
    expect(parseFormatLegalityQuery('   ', 'illegal')).toEqual({})
    expect(parseFormatLegalityQuery('edison', undefined)).toEqual({ formatId: 'edison', legality: 'legal' })
    expect(parseFormatLegalityQuery('edison', 'banned')).toEqual({ formatId: 'edison', legality: 'legal' })
    expect(parseFormatLegalityQuery(['edison', 'ocg'], ['limited'])).toEqual({ formatId: 'edison', legality: 'limited' })
  })

  it('is read by the catalog, the inventory search and the inventory list', () => {
    expect(parseCardListQuery({ formatId: 'goat', legality: 'illegal' })).toMatchObject({ formatId: 'goat', legality: 'illegal' })
    expect(parseCardListQuery({}).formatId).toBeUndefined()
    expect(parseInventorySearchQuery({ formatId: 'goat', legality: 'limited' })).toMatchObject({ formatId: 'goat', legality: 'limited' })
    expect(parseInventoryListQuery({ formatId: 'goat' })).toMatchObject({ formatId: 'goat', legality: 'legal' })
  })
})

describe('the filter on a database', () => {
  let db: ReturnType<typeof createTestDb>

  beforeEach(() => {
    clearFormatLegalityCache()
    db = createTestDb()
    db.insert(schema.user).values(['user-a', 'user-b'].map(id => ({
      id, name: id, email: `${id}@example.com`, emailVerified: false, createdAt: now, updatedAt: now,
    }))).run()
    seedCatalogFixture(db)
    seedBuiltinFormats(db)
  })

  async function catalogIds(query: Record<string, string>, userId = 'user-a') {
    const result = await searchCatalog(db, parseCardListQuery({ pageSize: '60', ...query }), 'en', userId)
    return result.items.map(item => item.id).sort((a, b) => a - b)
  }

  const idsOf = (...names: Array<keyof typeof ID>): number[] => names.map((name): number => ID[name]).sort((a, b) => a - b)

  it('gives every card its copy limit under the format, from the banlist of that format', () => {
    // TCG: Pot of Greed is forbidden, Monster Reborn limited.
    const tcg = formatCardLimits(db, 'user-a', 'tcg-advanced')!
    expect(tcg.get(ID.potOfGreed)).toBe(0)
    expect(tcg.get(ID.monsterReborn)).toBe(1)
    expect(tcg.get(ID.kuriboh)).toBe(3)
    // Goat: Pot of Greed and Mirror Force are limited, Raigeki and Monster Reborn forbidden.
    const goat = formatCardLimits(db, 'user-a', 'goat')!
    expect(goat.get(ID.potOfGreed)).toBe(1)
    expect(goat.get(ID.mirrorForce)).toBe(1)
    expect(goat.get(ID.raigeki)).toBe(0)
    expect(goat.get(ID.monsterReborn)).toBe(0)
  })

  it('has no limit for a format the user may not see, or one that does not exist', () => {
    const other = createRuleFormat(db, 'user-b', { name: 'Privat', description: null, rules: { rules: [{ kind: 'copies', maxCopies: 3 }] } })
    expect(formatCardLimits(db, 'user-a', other.id)).toBeNull()
    expect(formatCardLimits(db, 'user-a', 'no-such-format')).toBeNull()
    expect(formatCardLimits(db, 'user-b', other.id)).not.toBeNull()
    expect(legalityCardIds(db, 'user-a', { formatId: other.id, legality: 'legal' })).toBeNull()
    expect(legalityCardIds(db, 'user-a', {})).toBeNull()
  })

  it('does not count a retired card', () => {
    const limits = formatCardLimits(db, 'user-a', 'unlimited')!
    const retired = db.select().from(schema.catalogCard).all().filter(card => card.retiredAt !== null)
    expect(retired.length).toBeGreaterThan(0)
    for (const card of retired) {
      expect(limits.has(card.id), card.name).toBe(false)
    }
    expect(limits.size).toBe(db.select().from(schema.catalogCard).all().length - retired.length)
  })

  it('lists the cards a format allows, and the ones it does not, in the catalog', async () => {
    const all = await catalogIds({})
    const forbidden = idsOf('potOfGreed')

    expect(await catalogIds({ formatId: 'tcg-advanced', legality: 'illegal' })).toEqual(forbidden)
    expect(await catalogIds({ formatId: 'tcg-advanced', legality: 'legal' })).toEqual(all.filter(id => !forbidden.includes(id)))
    // Without a legality it is the cards one may play.
    expect(await catalogIds({ formatId: 'tcg-advanced' })).toEqual(all.filter(id => !forbidden.includes(id)))
  })

  it('lists the limited, semi-limited and unlimited cards', async () => {
    expect(await catalogIds({ formatId: 'tcg-advanced', legality: 'limited' })).toEqual(idsOf('monsterReborn'))
    expect(await catalogIds({ formatId: 'goat', legality: 'limited' })).toEqual(idsOf('potOfGreed', 'mirrorForce'))
    expect(await catalogIds({ formatId: 'goat', legality: 'semi_limited' })).toEqual([])
    const unlimited = await catalogIds({ formatId: 'goat', legality: 'unlimited' })
    expect(unlimited).not.toContain(ID.potOfGreed)
    expect(unlimited).not.toContain(ID.raigeki)
    expect(unlimited).toContain(ID.kuriboh)
  })

  it('follows a format of the player\'s own, with its card status rules', async () => {
    const own = createRuleFormat(db, 'user-a', {
      name: 'Mein Format',
      description: null,
      rules: {
        rules: [
          { kind: 'copies', maxCopies: 3 },
          { kind: 'card_status', status: 'forbidden', cardIds: [ID.kuriboh] },
          { kind: 'card_status', status: 'semi_limited', cardIds: [ID.darkMagician] },
          { kind: 'card_status', status: 'limited', cardIds: [ID.raigeki] },
        ],
      },
    })

    expect(await catalogIds({ formatId: own.id, legality: 'illegal' })).toEqual(idsOf('kuriboh'))
    expect(await catalogIds({ formatId: own.id, legality: 'semi_limited' })).toEqual(idsOf('darkMagician'))
    expect(await catalogIds({ formatId: own.id, legality: 'limited' })).toEqual(idsOf('raigeki'))
    // The same query by another player names a format they cannot see: nothing is filtered.
    expect(await catalogIds({ formatId: own.id, legality: 'illegal' }, 'user-b')).toEqual(await catalogIds({}, 'user-b'))
  })

  it('takes a format that changed: an edit makes new limits', async () => {
    const own = createRuleFormat(db, 'user-a', { name: 'Wandelbar', description: null, rules: { rules: [{ kind: 'copies', maxCopies: 3 }] } })
    expect(await catalogIds({ formatId: own.id, legality: 'illegal' })).toEqual([])

    const { updateRuleFormat } = await import('../../server/utils/rule-formats')
    updateRuleFormat(db, 'user-a', own.id, { rules: { rules: [{ kind: 'copies', maxCopies: 3 }, { kind: 'card_status', status: 'forbidden', cardIds: [ID.raigeki] }] } })
    expect(await catalogIds({ formatId: own.id, legality: 'illegal' })).toEqual(idsOf('raigeki'))
  })

  it('combines with the other filters of the catalog', async () => {
    expect(await catalogIds({ formatId: 'goat', legality: 'limited', kind: 'spell' })).toEqual(idsOf('potOfGreed'))
    expect(await catalogIds({ formatId: 'goat', legality: 'limited', kind: 'trap' })).toEqual(idsOf('mirrorForce'))
    expect(await catalogIds({ formatId: 'goat', legality: 'limited', owned: '1' })).toEqual([])
  })

  describe('in the inventory', () => {
    beforeEach(() => {
      const owned = (id: string, userId: string, catalogCardId: number, quantity: number) => ({
        id, userId, catalogCardId, quantity, collectionId: null, createdAt: now, updatedAt: now,
      })
      db.insert(schema.ownedCard).values([
        owned('o1', 'user-a', ID.potOfGreed, 2),
        owned('o2', 'user-a', ID.kuriboh, 3),
        owned('o3', 'user-a', ID.raigeki, 1),
        owned('o4', 'user-a', ID.mirrorForce, 1),
        owned('x1', 'user-b', ID.monsterReborn, 1),
      ]).run()
    })

    const listNames = (query: Record<string, string>) =>
      listOwnedCards(db, 'user-a', { ...parseInventoryListQuery({ pageSize: '100', ...query }), pageSize: 100 }).items.map(item => item.cardName).sort()

    function searchNames(query: Record<string, string>) {
      const filters = parseInventorySearchQuery(query)
      const where = buildInventorySearchWhere('user-a', filters, legalityCardIds(db, 'user-a', filters))
      return db
        .select({ name: schema.catalogCard.name })
        .from(schema.ownedCard)
        .innerJoin(schema.catalogCard, eq(schema.ownedCard.catalogCardId, schema.catalogCard.id))
        .where(where)
        .all()
        .map(row => row.name)
        .sort()
    }

    it('lists only the cards of the player that the format allows, in the list', () => {
      expect(listNames({})).toEqual(['Kuriboh', 'Mirror Force', 'Pot of Greed', 'Raigeki'])
      expect(listNames({ formatId: 'goat' })).toEqual(['Kuriboh', 'Mirror Force', 'Pot of Greed'])
      expect(listNames({ formatId: 'goat', legality: 'illegal' })).toEqual(['Raigeki'])
      expect(listNames({ formatId: 'goat', legality: 'limited' })).toEqual(['Mirror Force', 'Pot of Greed'])
      expect(listNames({ formatId: 'tcg-advanced', legality: 'illegal' })).toEqual(['Pot of Greed'])
    })

    it('does the same in the gallery search', () => {
      expect(searchNames({})).toEqual(['Kuriboh', 'Mirror Force', 'Pot of Greed', 'Raigeki'])
      expect(searchNames({ formatId: 'goat', legality: 'illegal' })).toEqual(['Raigeki'])
      expect(searchNames({ formatId: 'goat', legality: 'limited' })).toEqual(['Mirror Force', 'Pot of Greed'])
      expect(searchNames({ formatId: 'goat', legality: 'unlimited' })).toEqual(['Kuriboh'])
    })

    it('never shows the cards of someone else', () => {
      expect(listNames({ formatId: 'tcg-advanced', legality: 'limited' })).toEqual([])
    })
  })
})
