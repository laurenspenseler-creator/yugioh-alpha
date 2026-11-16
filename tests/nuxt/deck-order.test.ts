import { describe, expect, it } from 'vitest'
import { cardCategoryRank, compareDeckRows, compareDeckRowsBy, DECK_SORT_DEFAULT, isDeckSort, normalizeDeckSort } from '~~/shared/deck-order'
import type { DeckSort } from '~~/shared/deck-order'

// The deck-list order, shared by the server and the deck editor's optimistic rows (#148).
describe('compareDeckRows', () => {
  const magician = { type: 'Normal Monster', name: 'Dark Magician', nameDe: 'Dunkler Magier' }
  const pot = { type: 'Spell Card', name: 'Pot of Greed', nameDe: 'Topf der Gier' }
  const force = { type: 'Trap Card', name: 'Mirror Force', nameDe: 'Spiegelkraft' }
  const blueEyes = { type: 'Normal Monster', name: 'Blue-Eyes White Dragon', nameDe: 'Blauäugiger w. Drache' }

  it('ranks monsters, spells, traps', () => {
    expect([force, pot, magician].map(card => cardCategoryRank(card.type))).toEqual([2, 1, 0])
  })

  it('sorts the Main Deck by category, then by name in the card language', () => {
    const sorted = (locale: 'en' | 'de') => [force, pot, magician, blueEyes].sort((a, b) => compareDeckRows('main', a, b, locale)).map(card => card.name)
    expect(sorted('en')).toEqual(['Blue-Eyes White Dragon', 'Dark Magician', 'Pot of Greed', 'Mirror Force'])
    expect(sorted('de')).toEqual(['Blue-Eyes White Dragon', 'Dark Magician', 'Pot of Greed', 'Mirror Force'])
  })

  it('sorts Extra and Side by name only', () => {
    const sorted = [pot, force, magician].sort((a, b) => compareDeckRows('side', a, b, 'de')).map(card => card.nameDe)
    expect(sorted).toEqual(['Dunkler Magier', 'Spiegelkraft', 'Topf der Gier'])
  })
})

// Tester feedback, round 13: "kannst du bei Decks die Option hinzufügen, die Karten nach Erscheinungsdatum zu sortieren".
describe('compareDeckRowsBy', () => {
  const card = (name: string, tcgDate: string | null, type = 'Effect Monster') => ({ name, type, tcgDate })
  const kuriboh = card('Kuriboh', '2002-06-26')
  const pot = card('Pot of Greed', '2002-03-08', 'Spell Card')
  const raigeki = card('Raigeki', '2002-03-08', 'Spell Card')
  const decodeTalker = card('Decode Talker', '2017-07-21', 'Link Monster')
  const ocgOnly = card('Aaa OCG Card', null)
  const all = [kuriboh, decodeTalker, ocgOnly, raigeki, pot]
  const names = (sort: DeckSort, section: 'main' | 'extra' | 'side' = 'main') =>
    [...all].sort((a, b) => compareDeckRowsBy(sort, section, a, b, 'en')).map(row => row.name)

  it('is the conventional order by default', () => {
    expect(names('default')).toEqual([...all].sort((a, b) => compareDeckRows('main', a, b, 'en')).map(row => row.name))
  })

  it('lists the newest first, the oldest first, and a card without a date last in both', () => {
    expect(names('newest')).toEqual(['Decode Talker', 'Kuriboh', 'Pot of Greed', 'Raigeki', 'Aaa OCG Card'])
    expect(names('oldest')).toEqual(['Pot of Greed', 'Raigeki', 'Kuriboh', 'Decode Talker', 'Aaa OCG Card'])
  })

  it('keeps the usual order among cards of the same day, the Main Deck by category first', () => {
    const sameDay = [card('Zoma', '2005-01-01', 'Trap Card'), card('Mirror Force', '2005-01-01', 'Trap Card'), card('Abc', '2005-01-01', 'Normal Monster')]
    expect(sameDay.sort((a, b) => compareDeckRowsBy('newest', 'main', a, b, 'en')).map(row => row.name)).toEqual(['Abc', 'Mirror Force', 'Zoma'])
  })

  it('treats a missing or empty date like no date', () => {
    const rows = [{ name: 'B', type: 'Effect Monster' }, { name: 'A', type: 'Effect Monster', tcgDate: '' }, card('C', '2000-01-01')]
    expect(rows.sort((a, b) => compareDeckRowsBy('oldest', 'side', a, b, 'en')).map(row => row.name)).toEqual(['C', 'A', 'B'])
  })

  it('knows its choices: the usual order, or a field of the card lists with a direction, and the old "newest" and "oldest"', () => {
    expect(DECK_SORT_DEFAULT).toBe('default')
    for (const value of ['default', 'newest', 'oldest', 'release', '-release', 'atk', '-def', 'level', 'name', '-name', 'type', '-scale']) {
      expect(isDeckSort(value), value).toBe(true)
    }
    for (const value of ['random', '', '-', 'atk-', 'ATK', 'quantity', 'updated']) {
      expect(isDeckSort(value), value).toBe(false)
    }
    expect(isDeckSort(null)).toBe(false)
  })

  it('reads an old stored choice in the spelling of today', () => {
    expect(normalizeDeckSort('newest')).toBe('-release')
    expect(normalizeDeckSort('oldest')).toBe('release')
    expect(normalizeDeckSort('-atk')).toBe('-atk')
    expect(normalizeDeckSort('default')).toBe('default')
    expect(normalizeDeckSort('sideways')).toBe('default')
    expect(normalizeDeckSort(null)).toBe('default')
  })
})

// Tester feedback, round 16: one sort for every card list, a field and a direction.
describe('compareDeckRowsBy by every field', () => {
  const row = (name: string, extra: Record<string, unknown> = {}) => ({ name, type: 'Effect Monster', frameType: 'effect', ...extra })
  const names = (sort: string, rows: Array<ReturnType<typeof row>>, section: 'main' | 'extra' | 'side' = 'side') =>
    [...rows].sort((a, b) => compareDeckRowsBy(sort, section, a, b, 'en')).map(card => card.name)

  it('sorts by ATK and DEF, a card without one (a Spell) or with "?" (stored -1) last either way', () => {
    const rows = [row('Spell', { type: 'Spell Card', frameType: 'spell', atk: null }), row('Weak', { atk: 500 }), row('Strong', { atk: 3000 }), row('Unknown', { atk: -1 })]

    expect(names('atk', rows)).toEqual(['Weak', 'Strong', 'Spell', 'Unknown'])
    expect(names('-atk', rows)).toEqual(['Strong', 'Weak', 'Spell', 'Unknown'])
    const defs = [row('A', { def: 2000 }), row('B', { def: 100 }), row('C', { def: null })]
    expect(names('def', defs)).toEqual(['B', 'A', 'C'])
    expect(names('-def', defs)).toEqual(['A', 'B', 'C'])
  })

  it('sorts by level and by pendulum scale', () => {
    const rows = [row('L4', { level: 4 }), row('L8', { level: 8 }), row('Link', { level: null }), row('L1', { level: 1 })]
    expect(names('level', rows)).toEqual(['L1', 'L4', 'L8', 'Link'])
    expect(names('-level', rows)).toEqual(['L8', 'L4', 'L1', 'Link'])

    const scales = [row('S8', { scale: 8 }), row('None'), row('S0', { scale: 0 }), row('S3', { scale: 3 })]
    expect(names('scale', scales)).toEqual(['S0', 'S3', 'S8', 'None'])
    expect(names('-scale', scales)).toEqual(['S8', 'S3', 'S0', 'None'])
  })

  it('sorts by name in the card language, either way round', () => {
    const rows = [row('Charlie', { nameDe: 'Zeta' }), row('Alpha', { nameDe: 'Mu' }), row('Bravo', { nameDe: 'Beta' })]
    expect(names('name', rows)).toEqual(['Alpha', 'Bravo', 'Charlie'])
    expect(names('-name', rows)).toEqual(['Charlie', 'Bravo', 'Alpha'])
    expect([...rows].sort((a, b) => compareDeckRowsBy('name', 'main', a, b, 'de')).map(card => card.name)).toEqual(['Bravo', 'Alpha', 'Charlie'])
  })

  it('sorts by card type in the order of the game: Normal, Effekt, Ritual, Fusion ... Pendel ... Zauber, Falle', () => {
    const rows = [
      row('Trap', { type: 'Trap Card', frameType: 'trap' }),
      row('Fusion', { type: 'Fusion Monster', frameType: 'fusion' }),
      row('Spell', { type: 'Spell Card', frameType: 'spell' }),
      row('Normal', { type: 'Normal Monster', frameType: 'normal' }),
      row('Pendulum', { type: 'Pendulum Effect Monster', frameType: 'effect_pendulum' }),
      row('Effect'),
    ]
    expect(names('type', rows)).toEqual(['Normal', 'Effect', 'Fusion', 'Pendulum', 'Spell', 'Trap'])
    expect(names('-type', rows)).toEqual(['Trap', 'Spell', 'Pendulum', 'Fusion', 'Effect', 'Normal'])
  })

  it('keeps the usual order among cards that are level on the field', () => {
    const same = [row('Zed', { atk: 1000 }), row('Abe', { atk: 1000 })]
    expect(names('atk', same)).toEqual(['Abe', 'Zed'])
  })
})