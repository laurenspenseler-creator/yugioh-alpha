// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { Duel, DuelPlayer, DuelsState } from '../../shared/tournament-duels'
import { planQueue, queuePositions } from '../../shared/tournament-queue'
import { computeTable } from '../../shared/tournament-table'

const players = (n: number, patch: (i: number) => Partial<DuelPlayer> = () => ({})): DuelPlayer[] =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, seed: i + 1, status: 'active' as const, dropOption: null, ...patch(i) }))

let counter = 0
function duel(a: string, b: string, patch: Partial<Duel> = {}): Duel {
  counter += 1
  return { id: `d${counter}`, a, b, round: 1, kind: 'regular', status: 'planned', winner: null, table: null, startedAt: null, endedAt: null, ...patch }
}
const done = (a: string, b: string, winner: string, patch: Partial<Duel> = {}) => duel(a, b, { status: 'done', winner, endedAt: 1000, ...patch })

describe('computeTable', () => {
  it('sorts by wins and counts the duels played', () => {
    const state: DuelsState = {
      players: players(3),
      duels: [done('p1', 'p2', 'p1'), done('p1', 'p3', 'p1'), done('p2', 'p3', 'p2')],
    }
    const table = computeTable(state)

    expect(table.map(row => [row.playerId, row.wins, row.played, row.place])).toEqual([['p1', 2, 2, 1], ['p2', 1, 2, 2], ['p3', 0, 2, 3]])
  })

  it('counts the games of every duel, a single game as 1:0', () => {
    const state: DuelsState = {
      players: players(3),
      duels: [done('p1', 'p2', 'p1', { gamesA: 2, gamesB: 1 }), done('p3', 'p1', 'p1')],
    }
    const table = computeTable(state, 'match')

    expect(table.find(row => row.playerId === 'p1')).toMatchObject({ gamesWon: 3, gamesLost: 1 })
    expect(table.find(row => row.playerId === 'p2')).toMatchObject({ gamesWon: 1, gamesLost: 2 })
    expect(table.find(row => row.playerId === 'p3')).toMatchObject({ gamesWon: 0, gamesLost: 1 })
  })

  it('breaks a tie on points by the direct comparison, whatever the seeds say', () => {
    // p1 and p2 are level on points (3), games won (1) and difference (0); p2 beat p1, so p2 is ahead of the better seed.
    // p4 has 6 points and p3, p5 are level at the bottom.
    const state: DuelsState = {
      players: players(5),
      duels: [done('p2', 'p1', 'p2'), done('p1', 'p3', 'p1'), done('p4', 'p2', 'p4'), done('p4', 'p5', 'p4')],
    }
    const table = computeTable(state, 'match')

    expect(table.map(row => [row.playerId, row.place, row.tied])).toEqual([
      ['p4', 1, false],
      ['p2', 2, false],
      ['p1', 3, false],
      ['p3', 4, true],
      ['p5', 4, true],
    ])
  })

  it('breaks the tie that is left by the difference of the games, then by the games won', () => {
    // 'match' scoring, so everybody with one win has 3 points. p5 beat p2 (direct comparison puts p5 first); p2 and p1 are
    // level on the difference (+1), p2 has won more games (3 against 2) and is ahead of the better seed p1.
    const state: DuelsState = {
      players: players(5),
      duels: [
        done('p1', 'p3', 'p1', { gamesA: 2, gamesB: 1 }),
        done('p2', 'p4', 'p2', { gamesA: 2, gamesB: 0 }),
        done('p2', 'p5', 'p5', { gamesA: 1, gamesB: 2 }),
      ],
    }
    const table = computeTable(state, 'match')

    expect(table.map(row => row.playerId)).toEqual(['p5', 'p2', 'p1', 'p3', 'p4'])
    // p3 lost 1:2 and p4 lost 0:2: the better difference is ahead.
    expect(table.map(row => row.tied)).toEqual([false, false, false, false, false])
  })

  it('looks only at the duels among the players level on points: p2 has the best difference but beat nobody of the group', () => {
    // 'match' scoring: p1, p2, p3 and p4 all have 3 points. p3 beat p1, p1 beat p4, p4 beat p3 (each one win inside the
    // group), p2 only beat p5, who is not in the group. The direct comparison comes before the difference, so p2 (+1)
    // is behind the three that are level among each other, who share the first place.
    const state: DuelsState = {
      players: players(5),
      duels: [done('p3', 'p1', 'p3'), done('p1', 'p4', 'p1'), done('p2', 'p5', 'p2'), done('p4', 'p3', 'p4')],
    }
    const table = computeTable(state, 'match')

    expect(table.map(row => [row.playerId, row.points, row.place])).toEqual([
      ['p1', 3, 1],
      ['p3', 3, 1],
      ['p4', 3, 1],
      ['p2', 3, 4],
      ['p5', 0, 5],
    ])
    expect(table.slice(0, 3).every(row => row.tied)).toBe(true)
  })

  it('leaves a tie of two that split a rematch 1:1 as a shared place', () => {
    const state: DuelsState = {
      players: players(2),
      duels: [done('p1', 'p2', 'p1'), done('p1', 'p2', 'p2', { kind: 'rematch' })],
    }
    const table = computeTable(state)

    expect(table.map(row => row.place)).toEqual([1, 1])
    expect(table.every(row => row.tied)).toBe(true)
  })

  it('shares a place among three that beat each other in a circle', () => {
    const state: DuelsState = {
      players: players(3),
      duels: [done('p1', 'p2', 'p1'), done('p2', 'p3', 'p2'), done('p3', 'p1', 'p3')],
    }
    const table = computeTable(state)

    expect(table.map(row => row.place)).toEqual([1, 1, 1])
    expect(table.every(row => row.tied)).toBe(true)
  })

  it('does not show a disqualified player and lists one who left grey, last, without a place and with their record', () => {
    const state: DuelsState = {
      players: players(4, i => ({ status: i === 2 ? 'dropped' as const : i === 3 ? 'disqualified' as const : 'active' as const })),
      duels: [
        done('p1', 'p3', 'p3', { status: 'void' }),
        done('p2', 'p3', 'p3', { status: 'void' }),
        done('p1', 'p2', 'p1'),
        done('p1', 'p4', 'p1', { status: 'void' }),
      ],
    }
    const table = computeTable(state)

    expect(table.map(row => row.playerId)).toEqual(['p1', 'p2', 'p3'])
    const left = table.at(-1)!
    expect(left).toMatchObject({ left: true, place: null, wins: 2, played: 2 })
    // The struck duels count for nobody else.
    expect(table[0]).toMatchObject({ playerId: 'p1', wins: 1, played: 1 })
  })

  it('counts the Spieltage a player has played on: a day once, whatever the number of duels, and only done duels', () => {
    const state: DuelsState = {
      players: players(3),
      duels: [
        done('p1', 'p2', 'p1', { round: 1 }),
        done('p1', 'p3', 'p1', { round: 2 }),
        // A make-up duel carries the day it makes up for: p3 has two duels on day 2.
        done('p2', 'p3', 'p2', { round: 2, kind: 'makeup' }),
        duel('p1', 'p2', { round: 3 }),
      ],
    }
    const table = computeTable(state)

    expect(Object.fromEntries(table.map(row => [row.playerId, [row.played, row.matchdays]]))).toEqual({ p1: [2, 2], p2: [2, 2], p3: [2, 1] })
  })

  it('does not count a duel that is not done', () => {
    const state: DuelsState = { players: players(2), duels: [duel('p1', 'p2'), duel('p1', 'p2', { status: 'running' })] }

    expect(computeTable(state).map(row => row.played)).toEqual([0, 0])
  })
})

describe('points in the table', () => {
  const twoDuels = (games: Array<[number, number]>): DuelsState => ({
    players: players(3),
    duels: [
      done('p1', 'p2', 'p1', { gamesA: games[0]![0], gamesB: games[0]![1] }),
      done('p3', 'p1', 'p3', { gamesA: games[1]![0], gamesB: games[1]![1] }),
    ],
  })

  it('counts 3 for a win without losing a game, 2 for a win that lost one, 1 for a loss with a game won', () => {
    const table = computeTable(twoDuels([[2, 1], [2, 0]]), 'games')

    const points = Object.fromEntries(table.map(row => [row.playerId, row.points]))
    // p1: won 2:1 (2) and lost 0:2 (0); p2: lost 1:2 (1); p3: won 2:0 (3).
    expect(points).toEqual({ p1: 2, p2: 1, p3: 3 })
    expect(table.map(row => row.playerId)).toEqual(['p3', 'p1', 'p2'])
  })

  it('counts 3 and 0 with the classic scoring and for a single game', () => {
    const classic = computeTable(twoDuels([[2, 1], [2, 0]]), 'match')
    expect(Object.fromEntries(classic.map(row => [row.playerId, row.points]))).toEqual({ p1: 3, p2: 0, p3: 3 })

    const single: DuelsState = { players: players(2), duels: [done('p1', 'p2', 'p2')] }
    expect(computeTable(single, 'games').map(row => [row.playerId, row.points])).toEqual([['p2', 3], ['p1', 0]])
  })

  it('puts points before wins: a win and two games won in lost duels beat two narrow wins', () => {
    // p1: one 2:0 win (3) and two 1:2 losses (1 each) = 5 points; p2: two 2:1 wins = 4 points.
    const state: DuelsState = {
      players: players(6),
      duels: [
        done('p1', 'p3', 'p1', { gamesA: 2, gamesB: 0 }),
        done('p1', 'p4', 'p4', { gamesA: 1, gamesB: 2 }),
        done('p1', 'p5', 'p5', { gamesA: 1, gamesB: 2 }),
        done('p2', 'p3', 'p2', { gamesA: 2, gamesB: 1 }),
        done('p2', 'p6', 'p2', { gamesA: 2, gamesB: 1 }),
      ],
    }

    const table = computeTable(state, 'games')
    expect(table.slice(0, 2).map(row => [row.playerId, row.points, row.wins])).toEqual([['p1', 5, 1], ['p2', 4, 2]])
  })
})

describe('planQueue', () => {
  const state = (n: number, duels: Duel[], extra: Partial<DuelsState> = {}): DuelsState => ({ players: players(n), duels, ...extra })

  it('starts one duel per free table, never a player twice', () => {
    const duels = [duel('p1', 'p2'), duel('p1', 'p3'), duel('p3', 'p4'), duel('p5', 'p6')]
    const order = planQueue(state(6, duels), 3, 0)

    expect(order.start).toHaveLength(3)
    const players = order.start.flatMap(entry => {
      const d = duels.find(x => x.id === entry.duelId)!
      return [d.a, d.b]
    })
    expect(new Set(players).size).toBe(6)
    expect(order.start.map(entry => entry.table)).toEqual([1, 2, 3])
  })

  it('does not let the best duel leave a table empty when others can fill it', () => {
    // p1-p3 has the most open duels, but starting it leaves p2 and p4 without a partner: p1-p2 and p3-p4 fill two tables.
    const duels = [duel('p1', 'p3'), duel('p1', 'p2'), duel('p3', 'p4'), duel('p1', 'p5'), duel('p3', 'p6')]
    const order = planQueue(state(6, duels), 2, 0)

    expect(order.start).toHaveLength(2)
    const started = order.start.flatMap((entry) => {
      const d = duels.find(x => x.id === entry.duelId)!
      return [d.a, d.b]
    })
    expect(new Set(started).size).toBe(4)
  })

  it('uses no more tables than there are pairs of free players', () => {
    const order = planQueue(state(4, [duel('p1', 'p2'), duel('p3', 'p4')]), 10, 0)

    expect(order.usableFreeTables).toBe(2)
    expect(order.start).toHaveLength(2)
  })

  it('leaves the tables of running duels alone and numbers the new duel with the next free table', () => {
    const duels = [duel('p1', 'p2', { status: 'running', table: 1 }), duel('p3', 'p4'), duel('p5', 'p6')]
    const order = planQueue(state(6, duels), 3, 0)

    expect(order.start.map(entry => entry.table)).toEqual([2, 3])
    expect(order.start.map(entry => entry.duelId)).not.toContain(duels[0]!.id)
  })

  it('does not start a duel of a player who is playing', () => {
    const duels = [duel('p1', 'p2', { status: 'running', table: 1 }), duel('p1', 'p3'), duel('p4', 'p5')]
    const order = planQueue(state(5, duels), 3, 0)

    expect(order.start.map(entry => entry.duelId)).toEqual([duels[2]!.id])
  })

  it('goes for the players with the most open duels first', () => {
    // p1 and p2 have three open duels each, p3 and p4 one.
    const first = duel('p3', 'p4')
    const second = duel('p1', 'p2')
    const duels = [first, second, duel('p1', 'p5'), duel('p2', 'p6'), duel('p1', 'p6'), duel('p2', 'p5')]
    const order = planQueue(state(6, duels), 1, 0)

    expect(order.start[0]!.duelId).toBe(second.id)
  })

  it('goes for the one who has waited longest when the open duels are equal', () => {
    const early = duel('p1', 'p2')
    const late = duel('p3', 'p4')
    const duels = [late, early, done('p1', 'p9', 'p1', { endedAt: 100 }), done('p3', 'p9', 'p3', { endedAt: 5000 }), done('p2', 'p9', 'p2', { endedAt: 100 }), done('p4', 'p9', 'p4', { endedAt: 5000 })]
    const order = planQueue({ players: players(9), duels }, 1, 0)

    expect(order.start[0]!.duelId).toBe(early.id)
  })

  it('leaves out duels of players who left or were disqualified', () => {
    const duels = [duel('p1', 'p2'), duel('p3', 'p4')]
    const order = planQueue({ players: players(4, i => ({ status: i === 1 ? 'dropped' as const : 'active' as const })), duels }, 2, 0)

    expect(order.waiting.map(d => d.id)).toEqual([duels[1]!.id])
    expect(order.start).toHaveLength(1)
  })

  it('starts only the duels of the current day when the days are a gate (Spieltage)', () => {
    const duels = [duel('p1', 'p2', { round: 1 }), duel('p3', 'p4', { round: 1 }), duel('p1', 'p3', { round: 2 }), duel('p2', 'p4', { round: 2 })]
    const order = planQueue(state(4, duels), 4, 0, true)

    expect(order.start.map(entry => entry.duelId).sort()).toEqual([duels[0]!.id, duels[1]!.id].sort())
  })

  it('does not start the next day while a duel of the day is open, a queue without the gate does', () => {
    const duels = [
      duel('p1', 'p2', { round: 1, status: 'done', winner: 'p1', endedAt: 1000 }),
      duel('p3', 'p4', { round: 1, status: 'running', table: 1, startedAt: 500 }),
      duel('p1', 'p5', { round: 2 }),
    ]

    expect(planQueue(state(6, duels), 6, 0, true).start).toEqual([])
    expect(planQueue(state(6, duels), 6, 0, false).start).toHaveLength(1)
  })

  it('opens the next day by itself once the last duel of the day is done', () => {
    const duels = [
      duel('p1', 'p2', { round: 1, status: 'done', winner: 'p1', endedAt: 1000 }),
      duel('p3', 'p4', { round: 1, status: 'done', winner: 'p3', endedAt: 1100 }),
      duel('p1', 'p3', { round: 2 }),
      duel('p2', 'p4', { round: 2 }),
    ]

    expect(planQueue(state(4, duels), 4, 0, true).start).toHaveLength(2)
  })
})

describe('queuePositions', () => {
  it('gives every waiting player the number of the first duel they wait in, and nobody who plays', () => {
    const duels = [duel('p1', 'p2', { status: 'running', table: 1 }), duel('p3', 'p4'), duel('p3', 'p5'), duel('p1', 'p5')]
    const s: DuelsState = { players: players(5), duels }
    const order = planQueue(s, 1, 0)
    const positions = queuePositions(s, order)

    expect(positions.has('p1')).toBe(false)
    expect(positions.has('p2')).toBe(false)
    expect(positions.get('p3')).toBeGreaterThanOrEqual(1)
    expect(positions.get('p4')).toBeGreaterThanOrEqual(1)
    expect(positions.get('p5')).toBeGreaterThanOrEqual(1)
  })
})
