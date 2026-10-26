// @vitest-environment node
// A spoken list becomes card lines (ADR 0040). The first transcript is what the
// on-device Whisper really wrote for a recording of that sentence.
import { describe, expect, it } from 'vitest'
import { spokenCardLines } from '../../app/utils/spoken-card-lines'

describe('spokenCardLines', () => {
  it('splits what Whisper wrote for a spoken list into one line per card, with the numbers', () => {
    expect(spokenCardLines(' Drei blau-orgiger weiße Drache, zwei dunkler Magier, ein Kuribo und vier mystische Elfe.')).toEqual([
      '3x blau-orgiger weiße Drache',
      '2x dunkler Magier',
      'Kuribo',
      '4x mystische Elfe',
    ])
  })

  it('reads digits, "x" and "mal" as quantities', () => {
    expect(spokenCardLines('3 Dark Magician. 2x Kuriboh. zwei mal Sangan; 4× Raigeki')).toEqual([
      '3x Dark Magician',
      '2x Kuriboh',
      '2x Sangan',
      '4x Raigeki',
    ])
  })

  it('splits at "und" only where a new quantity follows, so a name with "und" stays whole', () => {
    expect(spokenCardLines('zwei Ritter und Drache und drei Kuriboh')).toEqual(['2x Ritter und Drache', '3x Kuriboh'])
    expect(spokenCardLines('Ash Blossom and Joyous Spring and three Maxx C')).toEqual(['Ash Blossom and Joyous Spring', '3x Maxx C'])
  })

  it('takes new lines as card ends, and drops a leading "und", filler words and the word "Karte"', () => {
    expect(spokenCardLines('Kuriboh\nund zwei die Karte Sangan\ndrei Karten Raigeki')).toEqual(['Kuriboh', '2x Sangan', '3x Raigeki'])
  })

  it('ignores a number that is too large for copies of a card and segments without letters', () => {
    expect(spokenCardLines('99 Kuriboh, 1, 2. , drei')).toEqual(['99 Kuriboh'])
    expect(spokenCardLines('')).toEqual([])
    expect(spokenCardLines('   ')).toEqual([])
  })

  it('understands English numbers too', () => {
    expect(spokenCardLines('two Dark Magician, three Kuriboh and one Sangan')).toEqual(['2x Dark Magician', '3x Kuriboh', 'Sangan'])
  })

  it('keeps the dots of an abbreviation spelled letter by letter, but ends a card at the dot after one letter', () => {
    expect(spokenCardLines('Topf der Gier, D.D. Kriegerin, zwei E.T. Dragon. Maxx C. Kuriboh')).toEqual(['Topf der Gier', 'D.D. Kriegerin', '2x E.T. Dragon', 'Maxx C', 'Kuriboh'])
  })

  it('starts the next card at a number in the middle of the text, when no commas were written', () => {
    expect(spokenCardLines('3 Ash Blossom and Joyous Spring 2 Mystical Space Typhoon 1 Pot of Greed 2 Dark Hole'))
      .toEqual(['3x Ash Blossom and Joyous Spring', '2x Mystical Space Typhoon', 'Pot of Greed', '2x Dark Hole'])
    // The number of a card's name is part of it.
    expect(spokenCardLines('2 Number 39 Utopia, ein Kuriboh')).toEqual(['2x Number 39 Utopia', 'Kuriboh'])
  })

  it('drops the sounds Whisper marks in brackets, asterisks or music notes, which no one said', () => {
    expect(spokenCardLines('* Musik *')).toEqual([])
    expect(spokenCardLines('[Music] (Applaus) ♪ la la')).toEqual([])
    expect(spokenCardLines('drei Kuriboh [BLANK_AUDIO] zwei Sangan, * Husten *')).toEqual(['3x Kuriboh', '2x Sangan'])
  })
})
