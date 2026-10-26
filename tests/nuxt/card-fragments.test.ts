// @vitest-environment node
// Which cards a photo shows, from the OCR text of the photo (ADR 0040). The
// pieces below are what the on-device OCR really read from a test photo of three
// cards laid side by side, noise included.
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import * as schema from '../../server/db/schema'
import { EVERYDAY_WORD_TEXTS, HEADER_SIZE, matchFragments, MAX_FRAGMENT_LENGTH, MAX_FRAGMENT_PASSES, MAX_FRAGMENTS_PER_PASS, SURE_SCORE } from '../../server/utils/card-fragments'
import { parseFragmentPasses } from '../../server/utils/card-fragments-input'
import { foldCardName } from '../../shared/card-name-fold'
import { seedGermanNames } from './fixtures/german-names'

const CARDS = [
  { id: 46986414, name: 'Dark Magician' },
  { id: 89631139, name: 'Blue-Eyes White Dragon' },
  { id: 40640057, name: 'Kuriboh' },
  { id: 15025844, name: 'Mystical Elf' },
]

function createTestDb(extra: Array<{ id: number, name: string, desc?: string }> = []) {
  const db = drizzle(new Database(':memory:'), { schema })
  migrate(db, { migrationsFolder: './server/db/migrations' })
  const now = new Date()
  db.insert(schema.catalogCard).values([...CARDS, ...extra].map(card => ({
    desc: '', ...card, type: 'Normal Monster', frameType: 'normal', nameSearch: foldCardName(card.name), syncedAt: now,
  }))).run()
  seedGermanNames(db, { 46986414: 'Dunkler Magier', 89631139: 'Blauäugiger Weißer Drache', 15025844: 'Mystische Elfe' })
  return db
}

// Two readings of the same photo (the page mode differs): whole lines, with the names in them.
const PASS_SPARSE = [
  'BLE ve Wine Dascon',
  'DARK MAGICIAN',
  'LUE-EYES hp D',
  '2995',
  'EY —-— » Te ly',
  'ATK/2500 DEF/ 2100',
  'ATK/3000 DEF/3500 |',
  'UEISHA, TV JOKY0,',
]
const PASS_BLOCK = [
  'fi BLUE-EYES WHITE Dragon (3 | ——',
  'ARK MAGICIAN i',
  '2 3222922 933339555 RIBOH ~ wi',
  '/ 7 n - : a. » Ta od',
  'NTN | A a i',
]

describe('matchFragments', () => {
  const db = createTestDb()

  it('finds the cards whose names were read well, in the noise of two readings, each once', () => {
    const matches = matchFragments(db, [PASS_SPARSE, PASS_BLOCK])

    // "RIBOH" is Kuriboh misread in two letters: too unsure to count without a second reading.
    expect(matches.map(match => match.name).sort()).toEqual(['Blue-Eyes White Dragon', 'Dark Magician'])
    // The two readings see the same copy, so it is one copy, not two.
    expect(matches.every(match => match.count === 1)).toBe(true)
    expect(matches.find(match => match.name === 'Dark Magician')!.score).toBeGreaterThan(SURE_SCORE)
    expect(matches.find(match => match.name === 'Blue-Eyes White Dragon')!.score).toBeGreaterThan(SURE_SCORE)
  })

  it('finds two names in one line, and a name misread in one letter', () => {
    const matches = matchFragments(db, [['| Dar Magician Ff Buue-Eves Wire Dragon 2 Ti A | KURIBOH el']])

    const byName = Object.fromEntries(matches.map(match => [match.name, match]))
    expect(byName['Dark Magician']).toMatchObject({ text: 'Dar Magician', count: 1 })
    expect(byName.Kuriboh).toMatchObject({ text: 'KURIBOH', score: 1 })
    // "Buue-Eves Wire Dragon" is too far off Blue-Eyes White Dragon: the other reading has to find it.
    expect(byName['Blue-Eyes White Dragon']).toBeUndefined()
  })

  it('counts copies a single reading sees, and takes the busiest reading, not the sum', () => {
    const matches = matchFragments(db, [
      ['DARK MAGICIAN', 'noise', 'DARK MAGICIAN', 'KURIBOH', 'DARK MAGICIAN'],
      ['DARK MAGICIAN', 'DARK MAGICIAN'],
    ])

    expect(matches.find(match => match.name === 'Dark Magician')!.count).toBe(3)
    expect(matches.find(match => match.name === 'Kuriboh')!.count).toBe(1)
    // The most copies first.
    expect(matches[0]!.name).toBe('Dark Magician')
  })

  it('reads German names too, and names the card by its English catalog name', () => {
    const matches = matchFragments(db, [['Blauäugiger Weißer Drache', 'DUNKLER MAGIER ATK/2500', 'Mystische Elfe']])

    expect(matches.map(match => match.name).sort()).toEqual(['Blue-Eyes White Dragon', 'Dark Magician', 'Mystical Elf'])
    expect(matches.find(match => match.name === 'Blue-Eyes White Dragon')!.score).toBe(1)
  })

  it('finds nothing in pure noise, digits and short words', () => {
    expect(matchFragments(db, [['BEETS EE ee — =', '5532222 | | = 29555505', 'ANT EN == J', 'weed DEZ Ks', 'to', '', 'a b c d e f']])).toEqual([])
    expect(matchFragments(db, [[]])).toEqual([])
  })
})

describe('parseFragmentPasses (the request body)', () => {
  it('takes plain text and lines with heights, cut to size', () => {
    expect(parseFragmentPasses([['DARK MAGICIAN', { text: 'KURIBOH', heights: [2.5] }]])).toEqual([[{ text: 'DARK MAGICIAN' }, { text: 'KURIBOH', heights: [2.5] }]])
    expect(parseFragmentPasses([[{ text: 'x'.repeat(MAX_FRAGMENT_LENGTH + 50) }]])![0]![0]!.text).toHaveLength(MAX_FRAGMENT_LENGTH)
  })

  it('refuses what is not a list of readings of lines', () => {
    for (const body of [undefined, null, 'nope', [], [[1]], [[{ heights: [1] }]], [[{ text: 'a', heights: 'tall' }]], [[{ text: 'a', heights: [Number.NaN] }]], [[{ text: 'a', heights: [-1] }]], [{}]]) {
      expect(parseFragmentPasses(body), JSON.stringify(body)).toBeNull()
    }
    expect(parseFragmentPasses(Array.from({ length: MAX_FRAGMENT_PASSES + 1 }, () => []))).toBeNull()
    expect(parseFragmentPasses([Array.from({ length: MAX_FRAGMENTS_PER_PASS + 1 }, () => 'a')])).toBeNull()
  })
})

describe('matchFragments: the printed name against the effect text', () => {
  const db = createTestDb()
  const small = 1
  const header = HEADER_SIZE + 0.5

  it('takes a name printed large, not the same name in the small effect text of another card', () => {
    // "Kuriboh" quoted in an effect text is small; as the card's name it is large.
    expect(matchFragments(db, [[{ text: 'If you control “Kuriboh”: draw 1 card.', heights: [small, small, small, small, small, small, small] }]])).toEqual([])
    expect(matchFragments(db, [[{ text: 'KURIBOH', heights: [header] }]]).map(match => match.name)).toEqual(['Kuriboh'])
  })

  it('takes the height of the window\'s own words, not of the whole line', () => {
    const matches = matchFragments(db, [[{ text: 'ATK/300 DARK MAGICIAN many small words follow here', heights: [small, header, header, small, small, small, small, small] }]])

    expect(matches.map(match => match.name)).toEqual(['Dark Magician'])
  })

  it('reads a card twice with a high score even when the name is not printed large (a name quoted in its own text)', () => {
    const lines = [{ text: 'DARK MAGICIAN', heights: [small, small] }, { text: 'once per turn, “Dark Magician” can', heights: [small, small, small, small, small, small] }]

    expect(matchFragments(db, [lines]).map(match => match.name)).toEqual(['Dark Magician'])
    expect(matchFragments(db, [[lines[0]!]])).toEqual([])
  })

  it('does not take everyday words of card texts for a card, unless a whole name is read', () => {
    // 200 card texts say "monster": a window "monster" is no sign of the card Monster Egg.
    const filler = Array.from({ length: EVERYDAY_WORD_TEXTS + 50 }, (_, index) => ({ id: 900000 + index, name: `Filler Card ${index}`, desc: 'A monster card.' }))
    const crowded = createTestDb([{ id: 41175645, name: 'Monster Egg' }, ...filler])

    expect(matchFragments(crowded, [[{ text: 'monster', heights: [header] }]])).toEqual([])
    expect(matchFragments(crowded, [[{ text: 'MONSTER EGG', heights: [header, header] }]]).map(match => match.name)).toEqual(['Monster Egg'])
  })
})
