// The "Deckthema" filter (the archetype of a card) of the catalog and the inventory (tester feedback, round 14).
import Database from 'better-sqlite3'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { beforeEach, describe, expect, it } from 'vitest'
import * as schema from '../../server/db/schema'
import { CATALOG_FIXTURE_IDS, seedCatalogFixture } from '../../server/db/fixtures/catalog-fixture'
import { buildCardListWhere, parseCardListQuery } from '../../server/utils/catalog-query'
import { getCatalogFacets, searchCatalog } from '../../server/utils/catalog-search'
import { listOwnedCards, parseInventoryListQuery } from '../../server/utils/inventory'
import { buildInventorySearchWhere, loadInventorySearchFacets, parseInventorySearchQuery } from '../../server/utils/inventory-search'

const ID = CATALOG_FIXTURE_IDS
const now = new Date()
/** An archetype with a comma in its name, as the real catalog has one. */
const ATLANTIS = 'Atlantis, City of the Sea Dragon'
const ATLANTIS_CARD = 770000001

function createTestDb() {
  const db = drizzle(new Database(':memory:'), { schema })
  migrate(db, { migrationsFolder: './server/db/migrations' })
  return db
}

describe('parsing the archetypes', () => {
  it('takes repeated keys and never splits at a comma', () => {
    expect(parseCardListQuery({ archetype: 'Blue-Eyes' }).archetypes).toEqual(['Blue-Eyes'])
    expect(parseCardListQuery({ archetype: ['Blue-Eyes', 'Stardust', 'Blue-Eyes'] }).archetypes).toEqual(['Blue-Eyes', 'Stardust'])
    expect(parseCardListQuery({ archetype: ATLANTIS }).archetypes).toEqual([ATLANTIS])
    expect(parseCardListQuery({ archetype: ['  Utopia  ', ''] }).archetypes).toEqual(['Utopia'])
    expect(parseCardListQuery({}).archetypes).toEqual([])

    expect(parseInventorySearchQuery({ archetype: [ATLANTIS, 'Kuriboh'] }).archetype).toEqual([ATLANTIS, 'Kuriboh'])
    expect(parseInventorySearchQuery({}).archetype).toEqual([])
    expect(parseInventoryListQuery({ archetype: ATLANTIS }).archetype).toEqual([ATLANTIS])
  })

  it('builds a condition without archetypes too', () => {
    expect(buildCardListWhere(parseCardListQuery({}))).toBeDefined()
  })
})

describe('the filter on a database', () => {
  let db: ReturnType<typeof createTestDb>

  beforeEach(() => {
    db = createTestDb()
    db.insert(schema.user).values(['user-a', 'user-b'].map(id => ({
      id, name: id, email: `${id}@example.com`, emailVerified: false, createdAt: now, updatedAt: now,
    }))).run()
    seedCatalogFixture(db)
    db.insert(schema.catalogCard).values({
      id: ATLANTIS_CARD, name: 'Atlantis Test Card', type: 'Effect Monster', frameType: 'effect', desc: '', archetype: ATLANTIS, syncedAt: now,
    }).run()

    const owned = (id: string, userId: string, catalogCardId: number) => ({
      id, userId, catalogCardId, quantity: 1, collectionId: null, createdAt: now, updatedAt: now,
    })
    db.insert(schema.ownedCard).values([
      owned('o1', 'user-a', ID.blueEyesWhiteDragon),
      owned('o2', 'user-a', ID.blueEyesUltimateDragon),
      owned('o3', 'user-a', ID.darkMagician),
      owned('o4', 'user-a', ID.raigeki), // a card without an archetype
      owned('o5', 'user-a', ATLANTIS_CARD),
      owned('x1', 'user-b', ID.stardustDragon),
    ]).run()
  })

  async function catalogNames(query: Record<string, string | string[]>) {
    const result = await searchCatalog(db, parseCardListQuery({ pageSize: '60', ...query }), 'en', 'user-a')
    return result.items.map(item => item.name).sort()
  }

  const listNames = (query: Record<string, string | string[]>) =>
    listOwnedCards(db, 'user-a', { ...parseInventoryListQuery(query), pageSize: 100 }).items.map(item => item.cardName).sort()

  function galleryNames(query: Record<string, string | string[]>) {
    const filters = parseInventorySearchQuery(query)
    return db
      .select({ name: schema.catalogCard.name })
      .from(schema.ownedCard)
      .innerJoin(schema.catalogCard, eq(schema.ownedCard.catalogCardId, schema.catalogCard.id))
      .where(buildInventorySearchWhere('user-a', filters))
      .all()
      .map(row => row.name)
      .sort()
  }

  it('lists the cards of a theme in the catalog', async () => {
    expect(await catalogNames({ archetype: 'Blue-Eyes' })).toEqual(['Blue-Eyes Ultimate Dragon', 'Blue-Eyes White Dragon'])
    expect(await catalogNames({ archetype: 'Stardust' })).toEqual(['Stardust Dragon'])
    expect(await catalogNames({ archetype: 'No Such Theme' })).toEqual([])
  })

  it('lists the cards of any of several themes', async () => {
    expect(await catalogNames({ archetype: ['Stardust', 'Utopia'] })).toEqual(['Number 39: Utopia', 'Stardust Dragon'])
  })

  it('finds a theme whose name has a comma', async () => {
    expect(await catalogNames({ archetype: ATLANTIS })).toEqual(['Atlantis Test Card'])
    // Asked for as two themes, it would find nothing: the comma is part of the name.
    expect(await catalogNames({ archetype: ['Atlantis', 'City of the Sea Dragon'] })).toEqual([])
  })

  it('combines with the other filters of the catalog', async () => {
    expect(await catalogNames({ archetype: 'Blue-Eyes', kind: 'fusion' })).toEqual(['Blue-Eyes Ultimate Dragon'])
    expect(await catalogNames({ archetype: 'Blue-Eyes', owned: '1' })).toEqual(['Blue-Eyes Ultimate Dragon', 'Blue-Eyes White Dragon'])
    expect(await catalogNames({ archetype: 'Stardust', owned: '1' })).toEqual([])
  })

  it('lists the themes of the catalog for the menu, once each and sorted, without a retired card\'s theme', async () => {
    const { archetypes } = await getCatalogFacets(db)
    expect(archetypes).toEqual([...archetypes].sort())
    expect(archetypes).toContain('Blue-Eyes')
    expect(archetypes.filter(name => name === 'Blue-Eyes')).toHaveLength(1)
    expect(archetypes).toContain(ATLANTIS)
    expect(archetypes).not.toContain('')
    // "Daedalus" belongs to a retired card only.
    expect(archetypes).not.toContain('Daedalus')
  })

  it('lists the cards of a theme in the inventory, in the list and in the gallery', () => {
    expect(listNames({ archetype: 'Blue-Eyes' })).toEqual(['Blue-Eyes Ultimate Dragon', 'Blue-Eyes White Dragon'])
    expect(galleryNames({ archetype: 'Blue-Eyes' })).toEqual(['Blue-Eyes Ultimate Dragon', 'Blue-Eyes White Dragon'])
    expect(listNames({ archetype: ['Dark Magician', ATLANTIS] })).toEqual(['Atlantis Test Card', 'Dark Magician'])
    expect(galleryNames({ archetype: ATLANTIS })).toEqual(['Atlantis Test Card'])
    expect(listNames({})).toHaveLength(5)
  })

  it('never shows the cards of someone else', () => {
    expect(listNames({ archetype: 'Stardust' })).toEqual([])
    expect(galleryNames({ archetype: 'Stardust' })).toEqual([])
  })

  it('lists the themes of the inventory for the menu: only those of the cards one owns', () => {
    expect(loadInventorySearchFacets(db, 'user-a').archetypes).toEqual(['Blue-Eyes', 'Dark Magician', ATLANTIS].sort((a, b) => a.localeCompare(b)))
    expect(loadInventorySearchFacets(db, 'user-b').archetypes).toEqual(['Stardust'])
  })
})
