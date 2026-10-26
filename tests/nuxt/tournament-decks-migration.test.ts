// Migration 0020 (ADR 0039): a participant's decks live in their own table.
// Every participant that had a registered deck keeps it as the first deck of the
// new table, with the snapshot, verdict and name it had. This runs 0000–0019 on
// an in-memory DB, seeds participants with and without a deck, applies 0020 the
// way the migrator does, and reads the decks back through the real reader.

import { readFileSync } from 'node:fs'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { describe, expect, it } from 'vitest'
import * as schema from '../../server/db/schema'
import { getTournamentDetail } from '../../server/utils/tournaments'

const MIGRATIONS = './server/db/migrations'
const DECKS_MIGRATION = 20

interface JournalEntry { idx: number, tag: string }

const journal = (JSON.parse(readFileSync(`${MIGRATIONS}/meta/_journal.json`, 'utf8')) as { entries: JournalEntry[] }).entries

function applyMigrations(sqlite: Database.Database, include: (entry: JournalEntry) => boolean) {
  for (const entry of journal.filter(include)) {
    const statements = readFileSync(`${MIGRATIONS}/${entry.tag}.sql`, 'utf8')
      .split('--> statement-breakpoint')
      .map(statement => statement.trim())
      .filter(statement => statement !== '')
    sqlite.exec('BEGIN')
    try {
      for (const statement of statements) {
        sqlite.prepare(statement).run()
      }
      sqlite.exec('COMMIT')
    }
    catch (error) {
      sqlite.exec('ROLLBACK')
      throw error
    }
  }
}

const SNAPSHOT = {
  deckId: 'deck-1',
  name: 'Altes Turnierdeck',
  sections: { main: [{ catalogCardId: 1, name: 'Kuriboh', quantity: 3 }], extra: [], side: [] },
  counts: { main: 3, extra: 0, side: 0, total: 3 },
  validation: { legal: false, issueCount: 1, issues: ['Main Deck has 3 cards; at least 40 are required.'] },
  capturedAt: '2026-09-12T11:13:52.000Z',
}

function databaseBeforeDecks() {
  const sqlite = new Database(':memory:')
  sqlite.pragma('foreign_keys = ON')
  applyMigrations(sqlite, entry => entry.idx < DECKS_MIGRATION)

  const now = Date.now()
  sqlite.prepare('INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)')
    .run('user-a', 'User A', 'a@example.com', now, now)
  sqlite.prepare('INSERT INTO tournament (id, organizer_user_id, name, pairing_system, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run('t-legacy', 'user-a', 'Altes Turnier', 'swiss', 'registration', now, now)
  const participant = sqlite.prepare('INSERT INTO tournament_participant (id, tournament_id, user_id, name, seed, deck_snapshot, deck_legal, deck_issue_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
  participant.run('p-with', 't-legacy', 'user-a', 'Mit Deck', 1, JSON.stringify(SNAPSHOT), 0, 1, now, now)
  participant.run('p-without', 't-legacy', null, 'Ohne Deck', 2, null, null, null, now, now)
  return sqlite
}

describe('migration 0020: decks of tournament participants (ADR 0039)', () => {
  it('moves the one deck of every participant into the new table, in front of the others', () => {
    const sqlite = databaseBeforeDecks()
    applyMigrations(sqlite, entry => entry.idx === DECKS_MIGRATION)

    const rows = sqlite.prepare('SELECT participant_id AS participantId, tournament_id AS tournamentId, name, deck_legal AS legal, deck_issue_count AS issueCount, position, deck_snapshot AS snapshot FROM tournament_participant_deck').all() as Array<Record<string, unknown>>

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ participantId: 'p-with', tournamentId: 't-legacy', name: 'Altes Turnierdeck', legal: 0, issueCount: 1, position: 0 })
    expect(JSON.parse(rows[0]!.snapshot as string)).toEqual(SNAPSHOT)
    expect(sqlite.pragma('foreign_key_check')).toEqual([])
  })

  it('shows the moved deck to the organizer, and nothing for a participant without one', () => {
    const sqlite = databaseBeforeDecks()
    applyMigrations(sqlite, entry => entry.idx >= DECKS_MIGRATION)

    const detail = getTournamentDetail(drizzle(sqlite, { schema }), 'user-a', 't-legacy')
    const decksOf = (name: string) => detail.participants.find(p => p.name === name)!.decks

    expect(decksOf('Mit Deck')).toEqual([
      expect.objectContaining({ name: 'Altes Turnierdeck', hasList: true, legal: false, issueCount: 1, snapshot: SNAPSHOT }),
    ])
    expect(decksOf('Ohne Deck')).toEqual([])
  })

  it('deletes the decks with their participant', () => {
    const sqlite = databaseBeforeDecks()
    applyMigrations(sqlite, entry => entry.idx === DECKS_MIGRATION)

    sqlite.prepare('DELETE FROM tournament_participant WHERE id = ?').run('p-with')

    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM tournament_participant_deck').get()).toEqual({ count: 0 })
  })
})
