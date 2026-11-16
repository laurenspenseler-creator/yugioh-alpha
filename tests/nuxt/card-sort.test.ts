// @vitest-environment node
// One sort for every card list (tester feedback, round 16): a field and a direction, in the URL as "atk" and "-atk".
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { beforeEach, describe, expect, it } from 'vitest'
import * as schema from '../../server/db/schema'
import { CATALOG_FIXTURE_CARDS, seedCatalogFixture } from '../../server/db/fixtures/catalog-fixture'
import { parseCardListQuery } from '../../server/utils/catalog-query'
import { searchCatalog } from '../../server/utils/catalog-search'
import { readSortValue } from '../../server/utils/card-sort-sql'
import { CARD_SORT_FIELDS, cardTypeRank, compareCardsBy, flipDirection, parseSortValue, sortValueOf } from '../../shared/card-sort'

describe('the sort values', () => {
  it('has the seven fields the testers named: release date, ATK, DEF, level, name, card type, pendulum scale', () => {
    expect([...CARD_SORT_FIELDS]).toEqual(['release', 'atk', 'def', 'level', 'name', 'type', 'scale'])
  })

  it('reads a field as ascending and a field with "-" in front as descending', () => {
    expect(parseSortValue('atk', CARD_SORT_FIELDS)).toEqual({ field: 'atk', direction: 'asc' })
    expect(parseSortValue('-atk', CARD_SORT_FIELDS)).toEqual({ field: 'atk', direction: 'desc' })
    expect(parseSortValue([' -name '], CARD_SORT_FIELDS)).toEqual({ field: 'name', direction: 'desc' })
  })

  it('reads the older "newest" and "oldest" as the release date, newest first and oldest first', () => {
    expect(parseSortValue('newest', CARD_SORT_FIELDS)).toEqual({ field: 'release', direction: 'desc' })
    expect(parseSortValue('oldest', CARD_SORT_FIELDS)).toEqual({ field: 'release', direction: 'asc' })
  })

  it('refuses what is not a field, a double minus, and a field of another list', () => {
    for (const value of ['', '-', '--atk', 'ATK', 'quantity', 'updated', undefined, null, 5, {}]) {
      expect(parseSortValue(value, CARD_SORT_FIELDS), String(value)).toBeUndefined()
    }
    // A list's own fields are only read where it names them.
    expect(parseSortValue('-quantity', [...CARD_SORT_FIELDS, 'quantity'])).toEqual({ field: 'quantity', direction: 'desc' })
  })

  it('writes a choice back the way it is read', () => {
    for (const value of ['release', '-release', 'atk', '-def', 'name', '-type', 'scale']) {
      expect(sortValueOf(parseSortValue(value, CARD_SORT_FIELDS)!)).toBe(value)
    }
    expect(flipDirection('asc')).toBe('desc')
    expect(flipDirection('desc')).toBe('asc')
  })

  it('takes the fallback for a request that has none, and the own fields of a list where it names them', () => {
    expect(readSortValue(undefined)).toBe('name')
    expect(readSortValue('bogus')).toBe('name')
    expect(readSortValue('newest')).toBe('-release')
    expect(readSortValue('-quantity')).toBe('name')
    expect(readSortValue('-quantity', 'name', ['quantity'])).toBe('-quantity')
    expect(readSortValue(undefined, '-updated', ['updated'])).toBe('-updated')
  })
})

describe('the sort of the catalog', () => {
  let db: ReturnType<typeof drizzle<typeof schema>>

  beforeEach(() => {
    db = drizzle(new Database(':memory:'), { schema })
    migrate(db, { migrationsFolder: './server/db/migrations' })
    seedCatalogFixture(db)
  })

  const rowOf = (id: number) => CATALOG_FIXTURE_CARDS.find(card => card.id === id)!

  async function sorted(sort: string) {
    const result = await searchCatalog(db, parseCardListQuery({ sort, pageSize: '60' }), 'en')
    return result.items.map(item => ({ item, row: rowOf(item.id) }))
  }

  /** The values are in order, and the cards without one (null, or "?" stored -1) come after all of those with one. */
  function expectOrdered(values: Array<number | string | null>, direction: 'asc' | 'desc', atLeast = 2) {
    const valued = values.filter((value): value is number | string => value !== null)
    expect(values.slice(0, valued.length), 'cards with a value come first').toEqual(valued)
    expect(valued).toEqual([...valued].sort((a, b) => (direction === 'asc' ? 1 : -1) * (a < b ? -1 : a > b ? 1 : 0)))
    expect(valued.length).toBeGreaterThanOrEqual(atLeast)
  }

  const stat = (value: number | null | undefined) => typeof value === 'number' && value >= 0 ? value : null

  it('sorts by ATK, either way round, a Spell and a "?" last', async () => {
    expectOrdered((await sorted('atk')).map(({ item }) => stat(item.atk)), 'asc')
    expectOrdered((await sorted('-atk')).map(({ item }) => stat(item.atk)), 'desc')
  })

  it('sorts by DEF, either way round', async () => {
    expectOrdered((await sorted('def')).map(({ item }) => stat(item.def)), 'asc')
    expectOrdered((await sorted('-def')).map(({ item }) => stat(item.def)), 'desc')
  })

  it('sorts by level, either way round, a Spell and a Link monster last', async () => {
    expectOrdered((await sorted('level')).map(({ item }) => stat(item.level)), 'asc')
    expectOrdered((await sorted('-level')).map(({ item }) => stat(item.level)), 'desc')
  })

  it('sorts by the release date, a card without one last, the older "newest" being "-release"', async () => {
    expectOrdered((await sorted('release')).map(({ row }) => row.tcgDate ?? null), 'asc')
    expectOrdered((await sorted('-release')).map(({ row }) => row.tcgDate ?? null), 'desc')
    expect((await sorted('newest')).map(({ item }) => item.id)).toEqual((await sorted('-release')).map(({ item }) => item.id))
  })

  it('sorts by the pendulum scale: the Pendulum monsters first, the rest by name', async () => {
    const scales = (await sorted('scale')).map(({ row }) => row.scale ?? null)
    expect(scales.some(scale => scale !== null)).toBe(true)
    // The fixture has one Pendulum monster: it comes before every card without a scale, either way round.
    expectOrdered(scales, 'asc', 1)
    expectOrdered((await sorted('-scale')).map(({ row }) => row.scale ?? null), 'desc', 1)
  })

  it('sorts by card type in the order of the game, the same as the browser sorts a deck', async () => {
    const ranks = (await sorted('type')).map(({ item }) => cardTypeRank(item))
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b))
    expect(new Set(ranks).size).toBeGreaterThan(3)
    const down = (await sorted('-type')).map(({ item }) => cardTypeRank(item))
    expect(down).toEqual([...down].sort((a, b) => b - a))
    // Monsters before Spells before Traps.
    const kinds = (await sorted('type')).map(({ item }) => item.type)
    expect(kinds.findIndex(type => type.includes('Spell'))).toBeGreaterThan(kinds.findLastIndex(type => type.includes('Monster')))
    expect(kinds.findIndex(type => type.includes('Trap'))).toBeGreaterThan(kinds.findLastIndex(type => type.includes('Spell')))
  })

  it('sorts by name, A to Z and Z to A', async () => {
    const up = (await sorted('name')).map(({ item }) => item.name)
    // The English names compare as they are (the database's own order for text).
    expect(up).toEqual([...up].sort())
    expect(up.slice().reverse()).toEqual((await sorted('-name')).map(({ item }) => item.name))
  })

  it('breaks a tie by name, so a page never changes its order between two requests', async () => {
    const level = await sorted('level')
    const names = level.filter(({ item }) => item.level === 8).map(({ item }) => item.name)
    expect(names).toEqual([...names].sort())
    expect((await sorted('atk')).map(({ item }) => item.id)).toEqual((await sorted('atk')).map(({ item }) => item.id))
  })

  it('has the same order in the browser: the deck editor sorts rows with `compareCardsBy`', async () => {
    const rows = (await sorted('-atk')).map(({ item }) => item)
    const inBrowser = [...rows].reverse().sort((a, b) => compareCardsBy({ field: 'atk', direction: 'desc' }, { ...a, tcgDate: null }, { ...b, tcgDate: null }, 'en'))
    expect(inBrowser.map(card => card.id)).toEqual(rows.map(card => card.id))
  })
})
