// @vitest-environment node
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'
import * as schema from '../../server/db/schema'
import {
  addParticipant,
  confirmRematch,
  createEveningDuel,
  createTournament,
  decideParticipantLeave,
  extendTournament,
  finishTournament,
  getTournamentDetail,
  leaveParticipant,
  recomputePairings,
  removeEveningDuel,
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
    expect(detail.queueSetup).toEqual({ mode: 'champions_league', rounds: 4, prelaunch: false, flow: 'queue', bestOf: 1, scoring: 'games', tables: 3, duelMinutes: 25 })
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


describe('a tournament played in Spieltage', () => {
  let db: TestDb
  beforeEach(() => {
    db = createTestDb()
    seedUsers(db)
  })

  it('plays a day at a time: the day side by side whatever the tables, the next one when the last duel is done', () => {
    const created = newQueueTournament(db, { mode: 'round_robin', flow: 'rounds', tables: 1 }, 6)
    const started = startTournament(db, ORGANIZER, created.id)

    expect(started.queueSetup).toMatchObject({ flow: 'rounds' })
    expect(started.queue!.flow).toBe('rounds')
    const firstDay = running(started.queue!)
    expect(firstDay).toHaveLength(3)
    expect([...new Set(firstDay.map(duel => duel.round))]).toEqual([1])

    let detail = reportDuelResult(db, ORGANIZER, created.id, firstDay[0]!.id, { winnerParticipantId: firstDay[0]!.participantAId })
    expect(running(detail.queue!)).toHaveLength(2)
    for (const duel of firstDay.slice(1)) {
      detail = reportDuelResult(db, ORGANIZER, created.id, duel.id, { winnerParticipantId: duel.participantAId })
    }
    const secondDay = running(detail.queue!)
    expect(secondDay).toHaveLength(3)
    expect([...new Set(secondDay.map(duel => duel.round))]).toEqual([2])
  })

  it('plays a whole tournament out and counts the remaining time in days', () => {
    const created = newQueueTournament(db, { mode: 'champions_league', plannedRounds: 4, flow: 'rounds', duelMinutes: 20 }, 6)
    const started = startTournament(db, ORGANIZER, created.id)

    expect(started.queue!.remainingMinutes).toBe(4 * 20)
    const finished = playOut(db, created.id)
    expect(finished.queue!.duelsDone).toBe(finished.queue!.duelsTotal)
    expect(finished.queue!.remainingMinutes).toBeNull()
  })

  it('works with the Swiss system and a head start too: round 2 waits for round 1', () => {
    const created = newQueueTournament(db, { mode: 'swiss', prelaunch: true, plannedRounds: 4, flow: 'rounds' }, 6)
    const started = startTournament(db, ORGANIZER, created.id)

    // Rounds 1 and 2 are paired at the start, but only round 1 is played.
    expect(started.queue!.duels.some(duel => duel.round === 2)).toBe(true)
    expect(running(started.queue!).every(duel => duel.round === 1)).toBe(true)
    expect(running(started.queue!)).toHaveLength(3)
  })

  it('lets the organizer enter a duel of a later day before it has begun: no order is forced', () => {
    const created = newQueueTournament(db, { mode: 'round_robin', flow: 'rounds' }, 4)
    const started = startTournament(db, ORGANIZER, created.id)
    const later = started.queue!.duels.find(duel => duel.round === 2)!
    expect(later.status).toBe('planned')

    const detail = reportDuelResult(db, ORGANIZER, created.id, later.id, { winnerParticipantId: later.participantAId })

    expect(detail.queue!.duels.find(duel => duel.id === later.id)).toMatchObject({ status: 'done', winnerParticipantId: later.participantAId })
    // The first day is still the one that is played.
    expect(running(detail.queue!).every(duel => duel.round === 1)).toBe(true)
    expect(detail.queue!.table.find(row => row.participantId === later.participantAId)!.wins).toBe(1)
  })

  it('does not take a duel that has not begun when the tournament has tables and a queue', () => {
    const created = newQueueTournament(db, { mode: 'round_robin', tables: 1 }, 4)
    const started = startTournament(db, ORGANIZER, created.id)
    const waiting = started.queue!.duels.find(duel => duel.status === 'planned')!

    expect(codeOf(() => reportDuelResult(db, ORGANIZER, created.id, waiting.id, { winnerParticipantId: waiting.participantAId }))).toBe('duel_not_running')
  })

  it('can be chosen until the start and not after', () => {
    const created = newQueueTournament(db, { mode: 'round_robin' }, 4)
    expect(updateTournament(db, ORGANIZER, created.id, { flow: 'rounds' }).queueSetup).toMatchObject({ flow: 'rounds' })
    startTournament(db, ORGANIZER, created.id)
    expect(codeOf(() => updateTournament(db, ORGANIZER, created.id, { flow: 'queue' }))).toBe('tournament_started')
    expect(codeOf(() => validateTournamentInput({ name: 'x', engine: 'queue', flow: 'bogus' }))).toBe('invalid_flow')
  })
})

describe('best of 3', () => {
  let db: TestDb
  beforeEach(() => {
    db = createTestDb()
    seedUsers(db)
  })

  it('takes the score with the winner and refuses a score that does not add up', () => {
    const created = newQueueTournament(db, { mode: 'round_robin', bestOf: 3, tables: 2 }, 4)
    const started = startTournament(db, ORGANIZER, created.id)
    expect(started.queueSetup).toMatchObject({ bestOf: 3 })
    const duel = running(started.queue!)[0]!
    const report = (body: Record<string, unknown>) => reportDuelResult(db, ORGANIZER, created.id, duel.id, body)

    expect(codeOf(() => report({ winnerParticipantId: duel.participantAId }))).toBe('invalid_games')
    expect(codeOf(() => report({ winnerParticipantId: duel.participantAId, gamesA: 1, gamesB: 2 }))).toBe('invalid_games')
    expect(codeOf(() => report({ winnerParticipantId: duel.participantAId, gamesA: 2, gamesB: 2 }))).toBe('invalid_games')
    expect(codeOf(() => report({ winnerParticipantId: duel.participantAId, gamesA: 3, gamesB: 0 }))).toBe('invalid_games')

    const detail = report({ winnerParticipantId: duel.participantBId, gamesA: 1, gamesB: 2 })
    const saved = detail.queue!.duels.find(candidate => candidate.id === duel.id)!
    expect([saved.status, saved.winnerParticipantId, saved.gamesA, saved.gamesB]).toEqual(['done', duel.participantBId, 1, 2])

    // A correction takes the new score too.
    const corrected = report({ winnerParticipantId: duel.participantAId, gamesA: 2, gamesB: 0 })
    const again = corrected.queue!.duels.find(candidate => candidate.id === duel.id)!
    expect([again.winnerParticipantId, again.gamesA, again.gamesB]).toEqual([duel.participantAId, 2, 0])
  })

  it('stores no score for a single game, whatever is sent', () => {
    const created = newQueueTournament(db, { mode: 'round_robin', tables: 2 }, 4)
    const started = startTournament(db, ORGANIZER, created.id)
    const duel = running(started.queue!)[0]!

    const detail = reportDuelResult(db, ORGANIZER, created.id, duel.id, { winnerParticipantId: duel.participantAId, gamesA: 2, gamesB: 1 })

    const saved = detail.queue!.duels.find(candidate => candidate.id === duel.id)!
    expect([saved.gamesA, saved.gamesB]).toEqual([null, null])
  })

  it('can be chosen until the start and refuses anything but 1 and 3', () => {
    const created = newQueueTournament(db, { mode: 'round_robin' }, 4)
    expect(updateTournament(db, ORGANIZER, created.id, { bestOf: 3 }).queueSetup).toMatchObject({ bestOf: 3 })
    expect(codeOf(() => validateTournamentInput({ name: 'x', engine: 'queue', bestOf: 2 }))).toBe('invalid_best_of')
    startTournament(db, ORGANIZER, created.id)
    expect(codeOf(() => updateTournament(db, ORGANIZER, created.id, { bestOf: 1 }))).toBe('tournament_started')
  })
})

describe('players named when the tournament is created', () => {
  let db: TestDb
  beforeEach(() => {
    db = createTestDb()
    seedUsers(db)
  })

  it('adds them all behind the organizer: guests by name, blank lines left out', () => {
    const detail = createTournament(db, ORGANIZER, validateTournamentInput({ name: 'Q', engine: 'queue', participants: ['Anna', '  Ben  ', ''] }))

    expect(detail.participants.map(participant => participant.name)).toEqual(['Organizer', 'Anna', 'Ben'])
  })

  it('adds an account by e-mail address', () => {
    const detail = createTournament(db, ORGANIZER, validateTournamentInput({ name: 'Q', engine: 'queue', includeSelf: false, participants: ['b@example.com'] }))

    expect(detail.participants.map(participant => [participant.name, participant.linked])).toEqual([['Somebody', true]])
  })

  it('creates nothing at all when one of them cannot be added', () => {
    const create = (participants: string[]) => () => createTournament(db, ORGANIZER, validateTournamentInput({ name: 'Q', engine: 'queue', participants }))

    expect(codeOf(create(['Anna', 'nobody@example.com']))).toBe('user_not_found')
    expect(codeOf(create(['Anna', 'anna']))).toBe('participant_exists')
    expect(db.select().from(schema.tournament).all()).toHaveLength(0)
    expect(db.select().from(schema.tournamentParticipant).all()).toHaveLength(0)
  })

  it('refuses a list that is not a list of names', () => {
    expect(codeOf(() => validateTournamentInput({ name: 'x', participants: 'Anna' }))).toBe('invalid_participants')
    expect(codeOf(() => validateTournamentInput({ name: 'x', participants: [1, 2] }))).toBe('invalid_participants')
  })

  const decksOf = (detail: TournamentDetail) => Object.fromEntries(detail.participants.map(participant => [participant.name, participant.decks.map(deck => deck.name)]))

  it('takes the decks in brackets behind a name: comma and slash tell them apart, spaces do not matter', () => {
    const detail = createTournament(db, ORGANIZER, validateTournamentInput({
      name: 'Q',
      engine: 'queue',
      includeSelf: false,
      participants: ['ANna (blue eyes, Grabwächter)', 'Fabi ( antiker antrieb, Cyber drache)', 'Darius ( Dark magician / Blue eyes )', 'Cara'],
    }))

    expect(detail.participants.map(participant => participant.name)).toEqual(['ANna', 'Fabi', 'Darius', 'Cara'])
    expect(decksOf(detail)).toEqual({
      ANna: ['blue eyes', 'Grabwächter'],
      Fabi: ['antiker antrieb', 'Cyber drache'],
      Darius: ['Dark magician', 'Blue eyes'],
      Cara: [],
    })
  })

  it('takes comma and slash in one bracket, a deck once, an unclosed bracket and the decks of an account', () => {
    const detail = createTournament(db, ORGANIZER, validateTournamentInput({
      name: 'Q',
      engine: 'queue',
      includeSelf: false,
      participants: ['Anna (Chaos, Zombie / Chaos, ,)', 'Ben (Drache', 'b@example.com (Dunkler Magier)'],
    }))

    expect(decksOf(detail)).toEqual({ Anna: ['Chaos', 'Zombie'], Ben: ['Drache'], Somebody: ['Dunkler Magier'] })
  })

  it('refuses a line with decks but no name, too many decks, and a deck name that is too long', () => {
    const create = (participants: string[]) => () => createTournament(db, ORGANIZER, validateTournamentInput({ name: 'Q', engine: 'queue', participants }))

    expect(codeOf(create(['(blue eyes)']))).toBe('invalid_participant')
    expect(codeOf(create(['Anna (a, b, c, d, e, f)']))).toBe('deck_limit')
    expect(codeOf(create([`Anna (${'x'.repeat(61)})`]))).toBe('invalid_deck_name')
    expect(db.select().from(schema.tournament).all()).toHaveLength(0)
  })
})

describe('one more Spieltag', () => {
  let db: TestDb
  beforeEach(() => {
    db = createTestDb()
    seedUsers(db)
  })

  const extend = (id: string) => extendTournament(db, ORGANIZER, id)

  it('is offered only when every duel is played, and then adds a day that is paired from the table', () => {
    const created = newQueueTournament(db, { mode: 'round_robin', flow: 'rounds' }, 4)
    const started = startTournament(db, ORGANIZER, created.id)
    expect(started.queue!.canExtend).toBe(false)
    expect(codeOf(() => extend(created.id))).toBe('schedule_not_over')

    const finished = playOut(db, created.id)
    expect(finished.queue!.canExtend).toBe(true)
    expect(finished.queue!.duelsTotal).toBe(6)

    const extended = extend(created.id)

    // After a full round robin everybody has met everybody: the new day is a return leg, played as the next day.
    const added = extended.queue!.duels.filter(duel => duel.round === 4)
    expect(added).toHaveLength(2)
    expect(new Set(added.flatMap(duel => [duel.participantAId, duel.participantBId])).size).toBe(4)
    expect(added.every(duel => duel.kind === 'rematch' && duel.status === 'running')).toBe(true)
    expect(extended.queue!.duelsTotal).toBe(8)
    expect(extended.queue!.canExtend).toBe(false)

    // ... and the tournament can be extended again once that day is played.
    expect(playOut(db, created.id).queue!.canExtend).toBe(true)
  })

  it('gives a Swiss tournament one more round', () => {
    const created = newQueueTournament(db, { mode: 'swiss', plannedRounds: 2, flow: 'rounds' }, 4)
    startTournament(db, ORGANIZER, created.id)
    expect(playOut(db, created.id).queue!.rounds).toBe(2)

    const extended = extend(created.id)

    expect(extended.queue!.rounds).toBe(3)
    expect(extended.queue!.duels.filter(duel => duel.round === 3)).toHaveLength(2)
    expect(running(extended.queue!).every(duel => duel.round === 3)).toBe(true)
  })

  it('draws a new day for a Champions League, with nobody twice on it', () => {
    const created = newQueueTournament(db, { mode: 'champions_league', plannedRounds: 4, flow: 'rounds' }, 8)
    startTournament(db, ORGANIZER, created.id)
    const finished = playOut(db, created.id)
    expect(finished.queue!.duelsTotal).toBe(16)

    const extended = extend(created.id)

    const added = extended.queue!.duels.filter(duel => duel.round > Math.max(...finished.queue!.duels.map(duel => duel.round)))
    expect(added).toHaveLength(4)
    expect(new Set(added.flatMap(duel => [duel.participantAId, duel.participantBId])).size).toBe(8)
  })

  it('pauses one player on a day of an odd field and still plays the others', () => {
    const created = newQueueTournament(db, { mode: 'round_robin', flow: 'rounds' }, 3)
    startTournament(db, ORGANIZER, created.id)
    playOut(db, created.id)

    const extended = extend(created.id)

    expect(extended.queue!.duels.filter(duel => duel.round === 4)).toHaveLength(1)
    expect(running(extended.queue!)).toHaveLength(1)
  })

  it('is not possible before the start, after the end, or for the classic tournament', () => {
    const created = newQueueTournament(db, { mode: 'round_robin', flow: 'rounds' }, 4)
    expect(codeOf(() => extend(created.id))).toBe('tournament_not_running')

    startTournament(db, ORGANIZER, created.id)
    playOut(db, created.id)
    finishTournament(db, ORGANIZER, created.id)
    expect(codeOf(() => extend(created.id))).toBe('tournament_not_running')
    expect(getTournamentDetail(db, ORGANIZER, created.id).queue!.canExtend).toBe(false)

    const classic = createTournament(db, ORGANIZER, validateTournamentInput({ name: 'Classic' }))
    expect(codeOf(() => extend(classic.id))).toBe('not_queue_tournament')
  })
})

describe('the table shows everybody', () => {
  let db: TestDb
  beforeEach(() => {
    db = createTestDb()
    seedUsers(db)
  })

  it('has a row for each of 11 players with single games and the scoring by games, whoever has played', () => {
    const created = newQueueTournament(db, { mode: 'round_robin', flow: 'rounds', bestOf: 1, scoring: 'games' }, 11)
    const started = startTournament(db, ORGANIZER, created.id)
    expect(started.queue!.duelsTotal).toBe(55)
    const [first, second] = running(started.queue!)

    reportDuelResult(db, ORGANIZER, created.id, first!.id, { winnerParticipantId: first!.participantAId })
    const detail = reportDuelResult(db, ORGANIZER, created.id, second!.id, { winnerParticipantId: second!.participantBId })

    const table = detail.queue!.table
    expect(table).toHaveLength(11)
    expect(new Set(table.map(row => row.participantId)).size).toBe(11)
    // The two winners share the first place and the points of a won single game.
    expect(table.slice(0, 2).map(row => [row.participantId, row.place, row.points]).sort()).toEqual(
      [[first!.participantAId, 1, 3], [second!.participantBId, 1, 3]].sort(),
    )
    // Games are shown for single games, too: 1:0 for the winner, 0:1 for the loser, who is below the ones who have not played.
    expect(table[0]).toMatchObject({ gamesWon: 1, gamesLost: 0 })
    expect(table.at(-1)).toMatchObject({ gamesWon: 0, gamesLost: 1 })
    expect(table.filter(row => row.gamesWon === 0 && row.gamesLost === 0)).toHaveLength(7)
  })
})

describe('the points of the table', () => {
  let db: TestDb
  beforeEach(() => {
    db = createTestDb()
    seedUsers(db)
  })

  /** Two players, one duel, entered with the winner and the score. */
  function playOne(body: Record<string, unknown>, result: Record<string, unknown>) {
    const created = newQueueTournament(db, { mode: 'round_robin', flow: 'rounds', ...body }, 2)
    const duel = running(startTournament(db, ORGANIZER, created.id).queue!)[0]!
    const detail = reportDuelResult(db, ORGANIZER, created.id, duel.id, { winnerParticipantId: duel.participantAId, ...result })
    const pointsOf = (id: string) => detail.queue!.table.find(row => row.participantId === id)!.points
    return [pointsOf(duel.participantAId), pointsOf(duel.participantBId)]
  }

  it('scores by games: 3 for 2:0, 2 for 2:1 and 1 for a duel lost with a game won', () => {
    expect(playOne({ bestOf: 3, scoring: 'games' }, { gamesA: 2, gamesB: 0 })).toEqual([3, 0])
    expect(playOne({ bestOf: 3, scoring: 'games' }, { gamesA: 2, gamesB: 1 })).toEqual([2, 1])
  })

  it('scores 3 and 0 with the classic scoring, whatever the score', () => {
    expect(playOne({ bestOf: 3, scoring: 'match' }, { gamesA: 2, gamesB: 1 })).toEqual([3, 0])
  })

  it('scores a single game 3 and 0 either way', () => {
    expect(playOne({ scoring: 'games' }, {})).toEqual([3, 0])
    expect(playOne({ scoring: 'match' }, {})).toEqual([3, 0])
  })

  it('keeps the scoring in the settings and changes it until the start', () => {
    const created = newQueueTournament(db, { mode: 'round_robin', scoring: 'match' }, 4)
    expect(created.queueSetup).toMatchObject({ scoring: 'match' })
    expect(updateTournament(db, ORGANIZER, created.id, { scoring: 'games' }).queueSetup).toMatchObject({ scoring: 'games' })
    startTournament(db, ORGANIZER, created.id)
    expect(codeOf(() => updateTournament(db, ORGANIZER, created.id, { scoring: 'match' }))).toBe('tournament_started')
  })
})

describe('a Spielabend: duels paired by hand', () => {
  let db: TestDb
  beforeEach(() => {
    db = createTestDb()
    seedUsers(db)
  })

  /** A started Spielabend with four players; `ids` are the participants in the order they were added. */
  function startedEvening(guests = 4) {
    const created = newQueueTournament(db, { mode: 'free' }, guests)
    const started = startTournament(db, ORGANIZER, created.id)
    return { id: created.id, started, ids: started.participants.map(participant => participant.id) }
  }

  const pair = (id: string, a: string, b: string, bestOf: unknown) =>
    createEveningDuel(db, ORGANIZER, id, { participantAId: a, participantBId: b, bestOf })

  it('is chosen as a mode, has no plan and starts with no duel at all', () => {
    const { started } = startedEvening()

    expect(started.queueSetup).toMatchObject({ mode: 'free', flow: 'rounds' })
    expect(started.status).toBe('running')
    expect(started.queue!.duels).toEqual([])
    expect(started.queue!.table).toHaveLength(4)
    expect(started.queue!.remainingMinutes).toBeNull()
    expect(started.queue!.canExtend).toBe(false)
    expect(started.queue!.firstPlaceTie).toEqual([])
  })

  it('starts a duel at once, a single game or best of 3 as chosen for this one duel, at the lowest free table', () => {
    const { id, ids } = startedEvening()

    const first = pair(id, ids[0]!, ids[1]!, 3)
    const second = pair(id, ids[2]!, ids[3]!, 1)

    expect(first.queue!.duels).toHaveLength(1)
    expect(first.queue!.duels[0]).toMatchObject({ status: 'running', bestOf: 3, tableNumber: 1, participantAId: ids[0], participantBId: ids[1] })
    expect(second.queue!.duels.map(duel => [duel.bestOf, duel.tableNumber])).toEqual([[3, 1], [1, 2]])
  })

  it('takes the best-of of the duel when the result is entered: the score for best of 3, none for a single game', () => {
    const { id, ids } = startedEvening()
    const bo3 = pair(id, ids[0]!, ids[1]!, 3).queue!.duels[0]!
    const single = pair(id, ids[2]!, ids[3]!, 1).queue!.duels[1]!
    const report = (duel: { id: string }, body: Record<string, unknown>) => reportDuelResult(db, ORGANIZER, id, duel.id, body)

    expect(codeOf(() => report(bo3, { winnerParticipantId: ids[0] }))).toBe('invalid_games')
    expect(codeOf(() => report(bo3, { winnerParticipantId: ids[0], gamesA: 2, gamesB: 2 }))).toBe('invalid_games')

    report(bo3, { winnerParticipantId: ids[1], gamesA: 1, gamesB: 2 })
    const detail = report(single, { winnerParticipantId: ids[2], gamesA: 2, gamesB: 1 })

    const duels = detail.queue!.duels
    expect(duels.find(duel => duel.id === bo3.id)).toMatchObject({ status: 'done', winnerParticipantId: ids[1], gamesA: 1, gamesB: 2 })
    expect(duels.find(duel => duel.id === single.id)).toMatchObject({ status: 'done', winnerParticipantId: ids[2], gamesA: null, gamesB: null })
  })

  // Tester feedback, round 16: "Verteil Punkte beim Spielabend über Duelle, nicht Matches. Da geht nur 3-0 oder 1-0."
  it('scores every duel (game) won 3 points, and ranks by points, then by the difference of the games', () => {
    const { id, ids, started } = startedEvening()
    expect(started.queueSetup).toMatchObject({ scoring: 'duel_3_0' })
    const bo3 = pair(id, ids[0]!, ids[1]!, 3).queue!.duels[0]!
    const single = pair(id, ids[2]!, ids[3]!, 1).queue!.duels[1]!
    reportDuelResult(db, ORGANIZER, id, bo3.id, { winnerParticipantId: ids[0], gamesA: 2, gamesB: 1 })
    const detail = reportDuelResult(db, ORGANIZER, id, single.id, { winnerParticipantId: ids[2] })

    const row = (participantId: string) => detail.queue!.table.find(candidate => candidate.participantId === participantId)!
    // 2:1 is two games for the winner (6 points) and one for the other (3), a single game 3 and 0.
    expect([row(ids[0]!).points, row(ids[0]!).gamesWon, row(ids[0]!).gamesLost]).toEqual([6, 2, 1])
    expect([row(ids[1]!).points, row(ids[1]!).gamesWon, row(ids[1]!).gamesLost]).toEqual([3, 1, 2])
    expect([row(ids[2]!).points, row(ids[2]!).gamesWon, row(ids[2]!).gamesLost]).toEqual([3, 1, 0])
    expect([row(ids[3]!).points, row(ids[3]!).gamesWon, row(ids[3]!).gamesLost]).toEqual([0, 0, 1])
    expect(detail.queue!.table[0]!.participantId).toBe(ids[0])
    expect(detail.queue!.duelsDone).toBe(2)
  })

  it('scores every duel won 1 point with "Pro Duell 1 · 0"', () => {
    const created = newQueueTournament(db, { mode: 'free', scoring: 'duel_1_0' }, 4)
    const started = startTournament(db, ORGANIZER, created.id)
    expect(started.queueSetup).toMatchObject({ scoring: 'duel_1_0' })
    const ids = started.participants.map(participant => participant.id)
    const bo3 = pair(created.id, ids[0]!, ids[1]!, 3).queue!.duels[0]!
    const single = pair(created.id, ids[2]!, ids[3]!, 1).queue!.duels[1]!
    reportDuelResult(db, ORGANIZER, created.id, bo3.id, { winnerParticipantId: ids[1], gamesA: 0, gamesB: 2 })
    const detail = reportDuelResult(db, ORGANIZER, created.id, single.id, { winnerParticipantId: ids[3] })

    const points = (participantId: string) => detail.queue!.table.find(row => row.participantId === participantId)!.points
    expect([points(ids[0]!), points(ids[1]!), points(ids[2]!), points(ids[3]!)]).toEqual([0, 2, 0, 1])
  })

  it('takes only the scorings per duel for a Spielabend and only the others for every other mode', () => {
    expect(codeOf(() => validateTournamentInput({ name: 'x', engine: 'queue', mode: 'free', scoring: 'games' }))).toBe('invalid_scoring')
    expect(codeOf(() => validateTournamentInput({ name: 'x', engine: 'queue', mode: 'free', scoring: 'match' }))).toBe('invalid_scoring')
    expect(codeOf(() => validateTournamentInput({ name: 'x', engine: 'queue', mode: 'swiss', scoring: 'duel_3_0' }))).toBe('invalid_scoring')
    expect(codeOf(() => validateTournamentInput({ name: 'x', scoring: 'duel_1_0' }))).toBe('invalid_scoring')
    expect(validateTournamentInput({ name: 'x', engine: 'queue', mode: 'free' }).scoring).toBe('duel_3_0')
    expect(validateTournamentInput({ name: 'x', engine: 'queue', mode: 'free', scoring: 'duel_1_0' }).scoring).toBe('duel_1_0')
    expect(validateTournamentInput({ name: 'x', engine: 'queue', mode: 'swiss' }).scoring).toBe('games')
  })

  it('changes the scoring with the mode until the start, and refuses one that does not fit', () => {
    const created = newQueueTournament(db, { mode: 'swiss', plannedRounds: 2, scoring: 'match' }, 4)

    const toEvening = updateTournament(db, ORGANIZER, created.id, { queueMode: 'free' })
    expect(toEvening.queueSetup).toMatchObject({ mode: 'free', scoring: 'duel_3_0' })
    expect(updateTournament(db, ORGANIZER, created.id, { scoring: 'duel_1_0' }).queueSetup).toMatchObject({ scoring: 'duel_1_0' })
    expect(codeOf(() => updateTournament(db, ORGANIZER, created.id, { scoring: 'games' }))).toBe('invalid_scoring')

    const back = updateTournament(db, ORGANIZER, created.id, { queueMode: 'round_robin' })
    expect(back.queueSetup).toMatchObject({ mode: 'round_robin', scoring: 'games' })
    expect(codeOf(() => updateTournament(db, ORGANIZER, created.id, { scoring: 'duel_3_0' }))).toBe('invalid_scoring')
    // Both at once is fine, and the new scoring has to fit the new mode.
    expect(updateTournament(db, ORGANIZER, created.id, { queueMode: 'free', scoring: 'duel_1_0' }).queueSetup).toMatchObject({ mode: 'free', scoring: 'duel_1_0' })
    expect(codeOf(() => updateTournament(db, ORGANIZER, created.id, { queueMode: 'swiss', scoring: 'duel_1_0' }))).toBe('invalid_scoring')
  })
  it('refuses a pair that does not work: the same player twice, someone in a duel, a stranger, a best-of that does not exist', () => {
    const { id, ids } = startedEvening()
    pair(id, ids[0]!, ids[1]!, 1)

    expect(codeOf(() => pair(id, ids[2]!, ids[2]!, 1))).toBe('invalid_pair')
    expect(codeOf(() => pair(id, ids[2]!, 'nobody', 1))).toBe('invalid_pair')
    expect(codeOf(() => pair(id, ids[2]!, undefined as unknown as string, 1))).toBe('invalid_pair')
    expect(codeOf(() => pair(id, ids[1]!, ids[2]!, 1))).toBe('player_in_duel')
    expect(codeOf(() => pair(id, ids[2]!, ids[3]!, 2))).toBe('invalid_best_of')
    expect(codeOf(() => pair(id, ids[2]!, ids[3]!, undefined))).toBe('invalid_best_of')
  })

  it('lets the same two play again once the duel is in', () => {
    const { id, ids } = startedEvening()
    const duel = pair(id, ids[0]!, ids[1]!, 1).queue!.duels[0]!
    reportDuelResult(db, ORGANIZER, id, duel.id, { winnerParticipantId: ids[0] })

    const detail = pair(id, ids[1]!, ids[0]!, 3)

    expect(detail.queue!.duels).toHaveLength(2)
    expect(detail.queue!.duels[1]).toMatchObject({ status: 'running', bestOf: 3, tableNumber: 1 })
  })

  it('takes back a duel that was paired by mistake, and only one that has not been played', () => {
    const { id, ids } = startedEvening()
    const wrong = pair(id, ids[0]!, ids[1]!, 3).queue!.duels[0]!
    const played = pair(id, ids[2]!, ids[3]!, 1).queue!.duels[1]!
    reportDuelResult(db, ORGANIZER, id, played.id, { winnerParticipantId: ids[2] })

    expect(codeOf(() => removeEveningDuel(db, ORGANIZER, id, played.id))).toBe('duel_not_open')
    expect(codeOf(() => removeEveningDuel(db, ORGANIZER, id, 'unknown'))).toBe('unknown_duel')

    const detail = removeEveningDuel(db, ORGANIZER, id, wrong.id)
    expect(detail.queue!.duels.map(duel => duel.id)).toEqual([played.id])
    // The two are free again, and the table of the removed duel is the next one handed out.
    expect(pair(id, ids[0]!, ids[3]!, 1).queue!.duels.at(-1)).toMatchObject({ tableNumber: 1 })
  })

  it('is for the organizer, for a Spielabend that runs, and for a Spielabend only', () => {
    const created = newQueueTournament(db, { mode: 'free' }, 3)
    const ids = created.participants.map(participant => participant.id)
    expect(codeOf(() => pair(created.id, ids[0]!, ids[1]!, 1))).toBe('tournament_not_running')

    startTournament(db, ORGANIZER, created.id)
    expect(() => createEveningDuel(db, 'user-b', created.id, { participantAId: ids[0], participantBId: ids[1], bestOf: 1 })).toThrow()

    const robin = newQueueTournament(db, { mode: 'round_robin' }, 3)
    startTournament(db, ORGANIZER, robin.id)
    const robinIds = robin.participants.map(participant => participant.id)
    expect(codeOf(() => pair(robin.id, robinIds[0]!, robinIds[1]!, 1))).toBe('not_free_tournament')
    expect(codeOf(() => removeEveningDuel(db, ORGANIZER, robin.id, 'any'))).toBe('not_free_tournament')

    finishTournament(db, ORGANIZER, created.id)
    expect(codeOf(() => pair(created.id, ids[0]!, ids[1]!, 1))).toBe('tournament_not_running')
  })

  it('keeps the settings of the evening: the best-of of the form is only what a new duel starts with', () => {
    const created = newQueueTournament(db, { mode: 'free', bestOf: 3 }, 2)
    const started = startTournament(db, ORGANIZER, created.id)
    const ids = started.participants.map(participant => participant.id)

    const detail = pair(created.id, ids[0]!, ids[1]!, 1)

    expect(detail.queueSetup).toMatchObject({ mode: 'free', bestOf: 3 })
    expect(detail.queue!.duels[0]).toMatchObject({ bestOf: 1 })
  })
})