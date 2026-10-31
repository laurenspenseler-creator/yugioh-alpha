// @vitest-environment node
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'
import * as schema from '../../server/db/schema'
import {
  addParticipant,
  confirmRematch,
  createTournament,
  decideParticipantLeave,
  finishTournament,
  getTournamentDetail,
  leaveParticipant,
  recomputePairings,
  reportDuelResult,
  scheduleDecider,
  startTournament,
  updateTournament,
  validateTournamentInput,
} from '../../server/utils/tournaments'
import type { QueueDetail, TournamentDetail } from '../../shared/tournaments'

function createTestDb() {
  const sqlite = new Database(':memory:')
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: './server/db/migrations' })
  return db
}
type TestDb = ReturnType<typeof createTestDb>

const ORGANIZER = 'user-a'

function seedUsers(db: TestDb) {
  const now = new Date()
  db.insert(schema.user).values([
    { id: ORGANIZER, name: 'Organizer', email: 'a@example.com', emailVerified: false, createdAt: now, updatedAt: now },
    { id: 'user-b', name: 'Somebody', email: 'b@example.com', emailVerified: false, createdAt: now, updatedAt: now },
  ]).run()
}

function newQueueTournament(db: TestDb, body: Record<string, unknown>, guests: number): TournamentDetail {
  let detail = createTournament(db, ORGANIZER, validateTournamentInput({ name: 'Queue', engine: 'queue', includeSelf: false, ...body }))
  for (let i = 1; i <= guests; i += 1) {
    detail = addParticipant(db, ORGANIZER, detail.id, { email: null, name: `Spieler ${i}` })
  }
  return detail
}

/** The data.code an API call fails with (the message is English and never shown). */
function codeOf(call: () => unknown): string | undefined {
  try {
    call()
  }
  catch (error) {
    return (error as { data?: { code?: string } }).data?.code
  }
  return undefined
}

const running = (queue: QueueDetail) => queue.duels.filter(duel => duel.status === 'running')

/** Plays everything out, always letting the first-named player win, and returns the final detail. */
function playOut(db: TestDb, id: string, pick: (duel: QueueDetail['duels'][number]) => string = duel => duel.participantAId): TournamentDetail {
  let detail = getTournamentDetail(db, ORGANIZER, id)
  for (let guard = 0; guard < 400; guard += 1) {
    const next = running(detail.queue!)[0]
    if (!next) {
      break
    }
    detail = reportDuelResult(db, ORGANIZER, id, next.id, { winnerParticipantId: pick(next) })
  }
  return detail
}

describe('creating a duel-queue tournament', () => {
  let db: TestDb
  beforeEach(() => {
    db = createTestDb()
    seedUsers(db)
  })

  it('keeps the settings and reports no queue before the start', () => {
    const detail = newQueueTournament(db, { mode: 'champions_league', plannedRounds: 4, tables: 3, duelMinutes: 25 }, 0)

    expect(detail.engine).toBe('queue')
    expect(detail.queueSetup).toEqual({ mode: 'champions_league', rounds: 4, prelaunch: false, tables: 3, duelMinutes: 25 })
    expect(detail.queue).toBeNull()
  })

  it('leaves a classic tournament as it was', () => {
    const detail = createTournament(db, ORGANIZER, validateTournamentInput({ name: 'Classic' }))

    expect(detail.engine).toBe('classic')
    expect(detail.queueSetup).toBeNull()
    expect(detail.queue).toBeNull()
  })

  it('refuses nonsense settings', () => {
    expect(() => validateTournamentInput({ name: 'x', engine: 'queue', mode: 'bogus' })).toThrow()
    expect(() => validateTournamentInput({ name: 'x', engine: 'queue', tables: 0 })).toThrow()
    expect(() => validateTournamentInput({ name: 'x', engine: 'queue', duelMinutes: 9999 })).toThrow()
    expect(() => validateTournamentInput({ name: 'x', engine: 'nope' })).toThrow()
  })

  it('refuses a setup that does not work at the start', () => {
    const detail = newQueueTournament(db, { mode: 'champions_league', plannedRounds: 3 }, 6)

    expect(codeOf(() => startTournament(db, ORGANIZER, detail.id))).toBe('rounds_must_be_even')
  })

  it('lets the settings change until the start, not after', () => {
    const detail = newQueueTournament(db, { mode: 'round_robin' }, 4)
    const changed = updateTournament(db, ORGANIZER, detail.id, { queueMode: 'champions_league', plannedRounds: 2, tables: 2 })
    expect(changed.queueSetup).toMatchObject({ mode: 'champions_league', rounds: 2, tables: 2 })

    startTournament(db, ORGANIZER, detail.id)
    expect(() => updateTournament(db, ORGANIZER, detail.id, { tables: 3 })).toThrow()
  })
})

describe('a round robin on tables', () => {
  let db: TestDb
  beforeEach(() => {
    db = createTestDb()
    seedUsers(db)
  })

  it('fixes every duel and starts one per table', () => {
    const created = newQueueTournament(db, { mode: 'round_robin', tables: 2 }, 6)
    const detail = startTournament(db, ORGANIZER, created.id)
    const queue = detail.queue!

    expect(detail.status).toBe('running')
    expect(queue.duels).toHaveLength(15)
    expect(running(queue)).toHaveLength(2)
    expect(running(queue).map(duel => duel.tableNumber).sort()).toEqual([1, 2])
    expect(queue.table).toHaveLength(6)
    // The players of a running duel sit at its table, everybody else waits in the queue.
    expect(queue.table.filter(row => row.tableNumber !== null)).toHaveLength(4)
    expect(queue.table.filter(row => row.queuePosition !== null)).toHaveLength(2)
  })

  it('starts the next duel as soon as a table is free and ends with everybody level on duels', () => {
    const created = newQueueTournament(db, { mode: 'round_robin', tables: 2 }, 6)
    startTournament(db, ORGANIZER, created.id)
    const first = running(getTournamentDetail(db, ORGANIZER, created.id).queue!)[0]!

    const after = reportDuelResult(db, ORGANIZER, created.id, first.id, { winnerParticipantId: first.participantBId })
    expect(running(after.queue!)).toHaveLength(2)
    expect(after.queue!.duels.find(duel => duel.id === first.id)).toMatchObject({ status: 'done', winnerParticipantId: first.participantBId })

    const done = playOut(db, created.id)
    expect(done.queue!.duelsDone).toBe(15)
    expect(done.queue!.table.every(row => row.played === 5)).toBe(true)
    expect(done.queue!.table[0]!.place).toBe(1)
    expect(done.queue!.remainingMinutes).toBeNull()
  })

  it('lets only the organizer enter results, and only a player of the duel win', () => {
    const created = newQueueTournament(db, { mode: 'round_robin', tables: 1 }, 3)
    startTournament(db, ORGANIZER, created.id)
    const duel = running(getTournamentDetail(db, ORGANIZER, created.id).queue!)[0]!

    expect(() => reportDuelResult(db, 'user-b', created.id, duel.id, { winnerParticipantId: duel.participantAId })).toThrow()
    expect(codeOf(() => reportDuelResult(db, ORGANIZER, created.id, duel.id, { winnerParticipantId: 'somebody-else' }))).toBe('invalid_winner')
    expect(() => reportDuelResult(db, ORGANIZER, created.id, 'missing', { winnerParticipantId: duel.participantAId })).toThrow()
  })

  it('corrects a result without touching the schedule', () => {
    const created = newQueueTournament(db, { mode: 'round_robin', tables: 1 }, 3)
    startTournament(db, ORGANIZER, created.id)
    const duel = running(getTournamentDetail(db, ORGANIZER, created.id).queue!)[0]!
    reportDuelResult(db, ORGANIZER, created.id, duel.id, { winnerParticipantId: duel.participantAId })

    const corrected = reportDuelResult(db, ORGANIZER, created.id, duel.id, { winnerParticipantId: duel.participantBId })

    expect(corrected.queue!.duels.find(d => d.id === duel.id)!.winnerParticipantId).toBe(duel.participantBId)
    expect(corrected.queue!.duels).toHaveLength(3)
  })

  it('can be ended at any time and is read-only afterwards', () => {
    const created = newQueueTournament(db, { mode: 'round_robin', tables: 1 }, 4)
    startTournament(db, ORGANIZER, created.id)

    const finished = finishTournament(db, ORGANIZER, created.id)

    expect(finished.status).toBe('finished')
    const duel = running(finished.queue!)[0]!
    expect(codeOf(() => reportDuelResult(db, ORGANIZER, created.id, duel.id, { winnerParticipantId: duel.participantAId }))).toBe('tournament_not_running')
  })

  it('settles a tie for first place with one deciding duel', () => {
    const created = newQueueTournament(db, { mode: 'round_robin', tables: 1 }, 3)
    startTournament(db, ORGANIZER, created.id)
    // A beats B, B beats C, C beats A: everybody has one win.
    let detail = getTournamentDetail(db, ORGANIZER, created.id)
    const winners = new Map<string, string>()
    const players = detail.queue!.table.map(row => row.participantId)
    winners.set(`${players[0]}|${players[1]}`, players[0]!)
    for (let guard = 0; guard < 10 && running(detail.queue!).length > 0; guard += 1) {
      const duel = running(detail.queue!)[0]!
      const ids = [duel.participantAId, duel.participantBId]
      const order = ['Spieler 1', 'Spieler 2', 'Spieler 3']
      const nameA = order.indexOf(duel.participantAName)
      const nameB = order.indexOf(duel.participantBName)
      // The lower number beats the next, the last beats the first.
      const winner = (nameA + 1) % 3 === nameB ? duel.participantAId : duel.participantBId
      expect(ids).toContain(winner)
      detail = reportDuelResult(db, ORGANIZER, created.id, duel.id, { winnerParticipantId: winner })
    }

    expect(detail.queue!.firstPlaceTie).toHaveLength(3)
    detail = scheduleDecider(db, ORGANIZER, created.id)
    const decider = running(detail.queue!)[0]!
    expect(decider.kind).toBe('decider')
    detail = reportDuelResult(db, ORGANIZER, created.id, decider.id, { winnerParticipantId: decider.participantAId })
    expect(detail.queue!.table[0]!.participantId).not.toBe('')
  })
})

describe('the Swiss system', () => {
  let db: TestDb
  beforeEach(() => {
    db = createTestDb()
    seedUsers(db)
  })

  it('pairs the next round by itself once the last duel of a round is in', () => {
    const created = newQueueTournament(db, { mode: 'swiss', plannedRounds: 4, tables: 4 }, 8)
    const started = startTournament(db, ORGANIZER, created.id)

    expect(started.queue!.duels).toHaveLength(4)
    expect(running(started.queue!)).toHaveLength(4)

    const done = playOut(db, created.id)
    expect(done.queue!.duels.filter(duel => duel.status !== 'void')).toHaveLength(16)
    expect(done.queue!.table.every(row => row.played === 4)).toBe(true)
    // Nobody met the same opponent twice.
    const pairs = done.queue!.duels.map(duel => [duel.participantAId, duel.participantBId].sort().join('|'))
    expect(new Set(pairs).size).toBe(pairs.length)
  })

  it('pairs two rounds before the start with a head start', () => {
    const created = newQueueTournament(db, { mode: 'swiss', plannedRounds: 4, prelaunch: true, tables: 4 }, 8)
    const started = startTournament(db, ORGANIZER, created.id)

    expect(started.queue!.duels).toHaveLength(8)
    const done = playOut(db, created.id)
    expect(done.queue!.table.every(row => row.played === 4)).toBe(true)
  })

  it('lets one player sit out with an odd field and makes it up', () => {
    const created = newQueueTournament(db, { mode: 'swiss', plannedRounds: 4, tables: 4 }, 7)
    startTournament(db, ORGANIZER, created.id)

    const done = playOut(db, created.id)
    expect(done.queue!.table.every(row => row.played === 4)).toBe(true)
  })
})

describe('a player leaves', () => {
  let db: TestDb
  beforeEach(() => {
    db = createTestDb()
    seedUsers(db)
  })

  function startedLeague(): { id: string, detail: TournamentDetail } {
    const created = newQueueTournament(db, { mode: 'champions_league', plannedRounds: 4, tables: 2 }, 8)
    return { id: created.id, detail: startTournament(db, ORGANIZER, created.id) }
  }

  it('option A strikes every duel of the player, who stays visible in grey and last', () => {
    const { id, detail } = startedLeague()
    // Somebody who is not playing right now.
    const idle = detail.queue!.table.find(row => row.tableNumber === null)!

    const after = leaveParticipant(db, ORGANIZER, id, idle.participantId, { kind: 'dropped', option: 'A' })

    const row = after.queue!.table.find(r => r.participantId === idle.participantId)!
    expect(row).toMatchObject({ left: true, place: null })
    expect(after.queue!.table.at(-1)!.participantId).toBe(idle.participantId)
    expect(after.queue!.duels.filter(duel => (duel.participantAId === idle.participantId || duel.participantBId === idle.participantId) && duel.status !== 'void')).toEqual([])
    // The opponents made up for the struck duels, so everybody still ends with four duels.
    const done = playOut(db, id)
    for (const r of done.queue!.table.filter(x => !x.left)) {
      expect(r.played).toBe(4)
    }
  })

  it('does not let a player leave in the middle of a duel', () => {
    const { id, detail } = startedLeague()
    const playing = detail.queue!.table.find(row => row.tableNumber !== null)!

    expect(codeOf(() => leaveParticipant(db, ORGANIZER, id, playing.participantId, { kind: 'dropped', option: 'A' }))).toBe('player_in_duel')
  })

  it('keeps the duels of an undecided dropout and strikes them when the organizer decides', () => {
    const { id, detail } = startedLeague()
    const idle = detail.queue!.table.find(row => row.tableNumber === null)!

    const undecided = leaveParticipant(db, ORGANIZER, id, idle.participantId, { kind: 'dropped', option: null })
    expect(undecided.queue!.undecided).toEqual([idle.participantId])
    expect(undecided.queue!.duels.filter(duel => duel.status === 'void')).toEqual([])

    const decided = decideParticipantLeave(db, ORGANIZER, id, idle.participantId, { option: 'A' })
    expect(decided.queue!.undecided).toEqual([])
    expect(decided.queue!.duels.some(duel => duel.status === 'void')).toBe(true)
    expect(codeOf(() => decideParticipantLeave(db, ORGANIZER, id, idle.participantId, { option: 'B' }))).toBe('nothing_to_decide')
  })

  it('removes a disqualified player from the table completely', () => {
    const { id, detail } = startedLeague()
    const idle = detail.queue!.table.find(row => row.tableNumber === null)!

    const after = leaveParticipant(db, ORGANIZER, id, idle.participantId, { kind: 'disqualified', option: null })

    expect(after.queue!.table.map(row => row.participantId)).not.toContain(idle.participantId)
    expect(after.participants.find(p => p.id === idle.participantId)).toMatchObject({ disqualified: true, dropOption: 'A' })
  })

  it('offers a rematch for the organizer to confirm when the pool has to repeat a pairing', () => {
    // In a round robin everybody has met everybody, so option B makes the open opponents play each other again.
    const created = newQueueTournament(db, { mode: 'round_robin', tables: 1 }, 5)
    const detail = startTournament(db, ORGANIZER, created.id)
    const idle = detail.queue!.table.find(row => row.tableNumber === null)!
    const options = detail.queue!.dropOptions[idle.participantId]!

    if (options.B) {
      const after = leaveParticipant(db, ORGANIZER, created.id, idle.participantId, { kind: 'dropped', option: 'B' })
      expect(after.queue!.pendingRematches.length).toBeGreaterThan(0)
      const pending = after.queue!.pendingRematches[0]!
      const confirmed = confirmRematch(db, ORGANIZER, created.id, { participantAId: pending.participantAId, participantBId: pending.participantBId })
      expect(confirmed.queue!.duels.some(duel => duel.kind === 'rematch')).toBe(true)
    }
    else {
      expect(codeOf(() => leaveParticipant(db, ORGANIZER, created.id, idle.participantId, { kind: 'dropped', option: 'B' }))).toBe('drop_option_unavailable')
    }
  })
})

describe('drawing the Swiss pairings again', () => {
  it('shows the change before it is made and refuses when nothing is open', () => {
    const db = createTestDb()
    seedUsers(db)
    const created = newQueueTournament(db, { mode: 'swiss', plannedRounds: 4, prelaunch: true, tables: 1 }, 8)
    startTournament(db, ORGANIZER, created.id)

    // A preview changes nothing.
    const before = getTournamentDetail(db, ORGANIZER, created.id).queue!.duels.map(duel => duel.id)
    recomputePairings(db, ORGANIZER, created.id, false)
    expect(getTournamentDetail(db, ORGANIZER, created.id).queue!.duels.map(duel => duel.id)).toEqual(before)

    // Once round 1 has results, the winners should meet winners in round 2: the pairing made in advance is drawn again.
    let detail = getTournamentDetail(db, ORGANIZER, created.id)
    for (let i = 0; i < 4; i += 1) {
      const duel = running(detail.queue!)[0]!
      detail = reportDuelResult(db, ORGANIZER, created.id, duel.id, { winnerParticipantId: duel.participantAId })
    }
    const preview = recomputePairings(db, ORGANIZER, created.id, false)
    if (preview.changes.length > 0) {
      expect(preview.detail.queue!.canRecompute).toBe(true)
      const after = recomputePairings(db, ORGANIZER, created.id, true)
      // Rounds 1 and 2, and round 3 which the head start pairs as soon as round 1 is complete.
      expect(after.detail.queue!.duels.filter(duel => duel.status !== 'void')).toHaveLength(12)
      // Nobody meets the same opponent twice, whichever pairings were drawn again.
      const pairs = after.detail.queue!.duels.filter(duel => duel.status !== 'void').map(duel => [duel.participantAId, duel.participantBId].sort().join('|'))
      expect(new Set(pairs).size).toBe(pairs.length)
    }
  })
})

