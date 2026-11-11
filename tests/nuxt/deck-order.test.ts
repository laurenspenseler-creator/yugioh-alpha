import { describe, expect, it } from 'vitest'
import { cardCategoryRank, compareDeckRows, compareDeckRowsBy, DECK_SORTS, isDeckSort } from '~~/shared/deck-order'
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

  it('knows its choices', () => {
    expect(DECK_SORTS).toEqual(['default', 'newest', 'oldest'])
    expect(isDeckSort('newest')).toBe(true)
    expect(isDeckSort('random')).toBe(false)
    expect(isDeckSort(null)).toBe(false)
  })
})
