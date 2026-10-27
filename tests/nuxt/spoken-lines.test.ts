// @vitest-environment node
// Dictated card lines, put together again where a pause cut one name in two (ADR 0040).
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import * as schema from '../../server/db/schema'
import { joinSpokenLines } from '../../server/utils/spoken-lines'
import { foldCardName } from '../../shared/card-name-fold'
import { seedGermanNames } from './fixtures/german-names'

const CARDS = [
  { id: 1, name: 'Black Luster Soldier' },
  { id: 2, name: 'Black Luster Soldier - Envoy of the Beginning' },
  { id: 3, name: 'Harpie\'s Feather Duster' },
  { id: 4, name: 'Magic Jammer' },
  { id: 5, name: 'Kuriboh' },
  { id: 6, name: 'Dark Magician' },
]

function createTestDb() {
  const db = drizzle(new Database(':memory:'), { schema })
  migrate(db, { migrationsFolder: './server/db/migrations' })
  const now = new Date()
  db.insert(schema.catalogCard).values(CARDS.map(card => ({
    desc: '', ...card, type: 'Effect Monster', frameType: 'effect', nameSearch: foldCardName(card.name), syncedAt: now,
  }))).run()
  seedGermanNames(db, {
    1: 'Schwarz Glänzender Soldat',
    2: 'Schwarz Glänzender Soldat - Gesandter des Anfangs',
    3: 'Harpyien-Flederwisch',
    4: 'Magische Störung',
    6: 'Dunkler Magier',
  })
  return db
}

describe('joinSpokenLines', () => {
  const db = createTestDb()

  it('joins the halves of a name cut by a pause, though the first half is a card of its own', () => {
    expect(joinSpokenLines(db, ['Topf der Gier', 'schwarz glänzender Soldat', 'Gesandter des Anfangs', 'Kuriboh']))
      .toEqual(['Topf der Gier', 'schwarz glänzender Soldat Gesandter des Anfangs', 'Kuriboh'])
  })

  it('joins two halves that are each no card, when together they are one', () => {
    expect(joinSpokenLines(db, ['Harpyien', 'Flederwisch'])).toEqual(['Harpyien Flederwisch'])
  })

  it('joins halves that are no card names but sound like one together ("Magic" "Gemma" for Magic Jammer)', () => {
    // The line becomes the name of the card it sounds like: the lookup would not find "Magic Gemma" by its letters.
    expect(joinSpokenLines(db, ['Kuriboh', 'Magic', 'Gemma', 'Dunkler Magier'])).toEqual(['Kuriboh', 'Magic Jammer', 'Dunkler Magier'])
    expect(joinSpokenLines(db, ['2x Magic', 'Gemma'])).toEqual(['2x Magic Jammer'])
  })

  it('does not join by sound when one half is a card name of its own', () => {
    expect(joinSpokenLines(db, ['Kuriboh', 'Gemma'])).toEqual(['Kuriboh', 'Gemma'])
  })

  it('keeps the quantity of the first line', () => {
    expect(joinSpokenLines(db, ['2x schwarz glänzender Soldat', 'Gesandter des Anfangs'])).toEqual(['2x schwarz glänzender Soldat Gesandter des Anfangs'])
  })

  it('leaves separate cards alone', () => {
    expect(joinSpokenLines(db, ['Kuriboh', 'Magic Jammer', 'Dark Magician'])).toEqual(['Kuriboh', 'Magic Jammer', 'Dark Magician'])
  })

  it('never joins a line that has a quantity of its own to the one before it', () => {
    expect(joinSpokenLines(db, ['schwarz glänzender Soldat', '2x Gesandter des Anfangs'])).toEqual(['schwarz glänzender Soldat', '2x Gesandter des Anfangs'])
  })

  it('cuts a line without any break into the cards it names, a number word before a card is its quantity', () => {
    expect(joinSpokenLines(db, ['Kuriboh Dunkler Magier Harpyien Flederwisch drei Kuriboh']))
      .toEqual(['Kuriboh', 'Dunkler Magier', 'Harpyien Flederwisch', '3x Kuriboh'])
  })

  it('cuts a run of cards that were heard wrongly, too', () => {
    expect(joinSpokenLines(db, ['Kuribo Dunkler Magiker Harpien Flederwisch Magic Jammer']))
      .toEqual(['Kuribo', 'Dunkler Magiker', 'Harpien Flederwisch', 'Magic Jammer'])
  })

  it('keeps a long name that is one card as a whole, and a short line as it is', () => {
    expect(joinSpokenLines(db, ['Schwarz Glänzender Soldat Gesandter des Anfangs'])).toEqual(['Schwarz Glänzender Soldat Gesandter des Anfangs'])
    expect(joinSpokenLines(db, ['Topf der Gier'])).toEqual(['Topf der Gier'])
  })

  it('has nothing to do for no lines or one', () => {
    expect(joinSpokenLines(db, [])).toEqual([])
    expect(joinSpokenLines(db, ['Kuriboh'])).toEqual(['Kuriboh'])
  })
})
