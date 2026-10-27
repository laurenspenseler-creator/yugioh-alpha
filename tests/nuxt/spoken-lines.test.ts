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

  it('keeps the quantity of the first line', () => {
    expect(joinSpokenLines(db, ['2x schwarz glänzender Soldat', 'Gesandter des Anfangs'])).toEqual(['2x schwarz glänzender Soldat Gesandter des Anfangs'])
  })

  it('leaves separate cards alone', () => {
    expect(joinSpokenLines(db, ['Kuriboh', 'Magic Jammer', 'Dark Magician'])).toEqual(['Kuriboh', 'Magic Jammer', 'Dark Magician'])
  })

  it('never joins a line that has a quantity of its own to the one before it', () => {
    expect(joinSpokenLines(db, ['schwarz glänzender Soldat', '2x Gesandter des Anfangs'])).toEqual(['schwarz glänzender Soldat', '2x Gesandter des Anfangs'])
  })

  it('has nothing to do for no lines or one', () => {
    expect(joinSpokenLines(db, [])).toEqual([])
    expect(joinSpokenLines(db, ['Kuriboh'])).toEqual(['Kuriboh'])
  })
})
