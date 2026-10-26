// @vitest-environment node
// "Handtraps sind verboten" in an imported rulebook (ADR 0038): the cards of the
// two definitions the user can pick, with the rulebook's exception taken out.
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import * as schema from '../../server/db/schema'
import { handtrapCardIds, isHandtrapDefinition, playedFromHandOutsideMainPhase } from '../../server/utils/handtrap-lists'
import classicPlusHandtraps from '../../server/utils/classic-plus-handtraps.json'

function createTestDb() {
  const db = drizzle(new Database(':memory:'), { schema })
  migrate(db, { migrationsFolder: './server/db/migrations' })
  const now = new Date()
  const card = (id: number, name: string, type: string, desc: string, retiredAt: Date | null = null) => ({ id, name, type, desc, frameType: 'effect', syncedAt: now, retiredAt })
  db.insert(schema.catalogCard).values([
    // On the Classic Plus list (rule 4) and written as a hand trap.
    card(14558127, 'Ash Blossom & Joyous Spring', 'Effect Monster', 'When a card or effect is activated that includes any of these effects: You can discard this card; negate that effect.'),
    card(46613515, 'Clear Kuriboh', 'Effect Monster', 'During your opponent\'s turn, when a monster effect is activated: You can send this card from your hand to the GY.'),
    // Not on the Classic Plus list (it only works in the Battle Phase), but a hand trap by its text.
    card(40640057, 'Kuriboh', 'Effect Monster', 'During the Damage Step, when your opponent\'s monster attacks: You can discard this card; you take no battle damage.'),
    card(99900001, 'Ankuriboh', 'Effect Monster', 'When your opponent activates a card or effect: You can discard this card; draw 1 card.'),
    // A card of the text definition that is retired from the catalog is left out.
    card(99900002, 'Retired Trap', 'Effect Monster', 'During the Battle Phase: You can discard this card.', new Date()),
    // Main Phase effects from the hand are not hand traps, and neither is a Trap Card that says "discard".
    card(99900003, 'Main Phase Dragon', 'Effect Monster', 'During your Main Phase: You can Special Summon this card from your hand.'),
    card(99900004, 'Discard Trap', 'Trap Card', 'During the Battle Phase, discard this card to negate an attack.'),
    card(99900005, 'Blue Plain', 'Normal Monster', 'A plain monster.'),
  ]).run()
  return db
}

describe('playedFromHandOutsideMainPhase', () => {
  it('recognises the hand effects of the well-known hand traps', () => {
    expect(playedFromHandOutsideMainPhase('When a card or effect is activated: You can discard this card; negate that effect.')).toBe(true)
    expect(playedFromHandOutsideMainPhase('If your opponent Special Summons a monster(s): You can send this card from your hand to the GY.')).toBe(true)
    expect(playedFromHandOutsideMainPhase('(Quick Effect): You can Special Summon this card from your hand.')).toBe(true)
  })

  it('does not take effects of the owner\'s own Main Phase, or a text without the hand', () => {
    expect(playedFromHandOutsideMainPhase('During your Main Phase: You can Special Summon this card from your hand.')).toBe(false)
    expect(playedFromHandOutsideMainPhase('When a monster effect is activated: negate it.')).toBe(false)
    expect(playedFromHandOutsideMainPhase('')).toBe(false)
  })
})

describe('handtrapCardIds', () => {
  it('knows the two definitions', () => {
    expect(isHandtrapDefinition('classic-plus')).toBe(true)
    expect(isHandtrapDefinition('restrictive')).toBe(true)
    expect(isHandtrapDefinition('own')).toBe(false)
    expect(isHandtrapDefinition(undefined)).toBe(false)
  })

  it('ships a list of Classic Plus hand traps (rule 4) that follows the banlist generation', () => {
    expect(classicPlusHandtraps.ids.length).toBeGreaterThan(50)
    expect(classicPlusHandtraps.ids).toEqual([...classicPlusHandtraps.ids].sort((a, b) => a - b))
    expect(classicPlusHandtraps.ids).toContain(14558127)
  })

  it('returns the Classic Plus cards that exist in the catalog', () => {
    expect(handtrapCardIds(createTestDb(), 'classic-plus')).toEqual([14558127, 46613515])
  })

  it('returns every monster the text says is played from the hand outside the Main Phase', () => {
    expect(handtrapCardIds(createTestDb(), 'restrictive')).toEqual([14558127, 40640057, 46613515, 99900001])
  })

  it('takes the exception out: only the card with exactly that name', () => {
    const db = createTestDb()

    // "Kuriboh" is a card of its own, so "Ankuriboh" and "Clear Kuriboh" stay.
    expect(handtrapCardIds(db, 'restrictive', 'Kuriboh')).toEqual([14558127, 46613515, 99900001])
    // The Classic Plus list doesn't hold Kuriboh itself, so the exception changes nothing there.
    expect(handtrapCardIds(db, 'classic-plus', 'Kuriboh')).toEqual([14558127, 46613515])
    expect(handtrapCardIds(db, 'classic-plus', 'clear kuriboh')).toEqual([14558127])
    expect(handtrapCardIds(db, 'restrictive', '  ')).toHaveLength(4)
  })
})
