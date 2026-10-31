// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { isFillerWord, nameWords, wordMatch, wordOverlap } from '../../shared/card-name-words'

describe('nameWords', () => {
  it('folds the words of a name and drops the filler', () => {
    expect(nameWords('Gaia, der wilde Ritter')).toEqual(['gaia', 'wilde', 'ritter'])
    expect(nameWords('Blauäugiger weißer Drache')).toEqual(['blauaugiger', 'weisser', 'drache'])
    expect(nameWords('Pot of Greed')).toEqual(['pot', 'greed'])
  })

  it('keeps a hyphenated name as two words', () => {
    expect(nameWords('Gold-Sarkophag')).toEqual(['gold', 'sarkophag'])
  })
})

describe('isFillerWord', () => {
  it('knows articles in any case, German and English', () => {
    expect(isFillerWord('Der')).toBe(true)
    expect(isFillerWord('the')).toBe(true)
    expect(isFillerWord('Ritter')).toBe(false)
  })
})

describe('wordMatch', () => {
  it('is 1 for the same word and less for a stem, a synonym or a compound', () => {
    expect(wordMatch('ritter', 'ritter')).toBe(1)
    expect(wordMatch('zornige', 'zorniger')).toBeLessThan(1)
    expect(wordMatch('zornige', 'zorniger')).toBeGreaterThan(0.8)
    expect(wordMatch('wilde', 'zorniger')).toBeCloseTo(0.7, 5)
    expect(wordMatch('ritter', 'polarritter')).toBeCloseTo(0.4, 5)
  })

  it('is 0 for different words', () => {
    expect(wordMatch('drache', 'ritter')).toBe(0)
    expect(wordMatch('dunkel', 'drache')).toBe(0)
  })
})

describe('wordOverlap', () => {
  it('scores the words two names share, a synonym a little less than the same word', () => {
    const query = nameWords('Gaia der wilde Ritter')
    const fierce = wordOverlap(query, nameWords('Gaia, zorniger Ritter'))
    const polar = wordOverlap(query, nameWords('Gaia, der Polarritter'))

    expect(fierce).toBeGreaterThan(0.8)
    expect(polar).toBeLessThan(0.55)
    expect(wordOverlap(query, nameWords('Gaia, wilder Ritter'))).toBeGreaterThan(fierce)
  })

  it('is 1 for the same words and 0 for none', () => {
    expect(wordOverlap(['gaia', 'ritter'], ['gaia', 'ritter'])).toBe(1)
    expect(wordOverlap(['gaia'], ['drache'])).toBe(0)
    expect(wordOverlap([], ['drache'])).toBe(0)
  })

  it('matches every word at most once', () => {
    // "Ritter Ritter" is not twice as close to "Gaia, zorniger Ritter" as "Ritter" is.
    expect(wordOverlap(['ritter', 'ritter'], ['gaia', 'ritter'])).toBeLessThan(0.6)
  })
})
