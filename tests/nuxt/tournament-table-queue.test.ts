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

  it('breaks a tie by the Buchholz sum: the wins of everybody one played', () => {
    // p1 and p2 each have one win; p1 beat p3 (who has 2 wins), p2 beat p4 (who has 0).
    const state: DuelsState = {
      players: players(4),
      duels: [done('p1', 'p3', 'p1'), done('p2', 'p4', 'p2'), done('p3', 'p5', 'p3'), done('p3', 'p6', 'p3')],
    }
    const table = computeTable({ ...state, players: players(6) })

    const p1 = table.find(row => row.playerId === 'p1')!
    const p2 = table.find(row => row.playerId === 'p2')!
    expect(p1.wins).toBe(1)
    expect(p1.buchholz).toBe(2)
    expect(p2.buchholz).toBe(0)
    expect(table.findIndex(row => row.playerId === 'p1')).toBeLessThan(table.findIndex(row => row.playerId === 'p2'))
  })

  it('breaks a tie of exactly two by their own duel when the Buchholz sums are equal', () => {
    // p1 and p2 each win one and lose one, same opponents' wins; p2 beat p1.
    const state: DuelsState = {
      players: players(2),
      duels: [done('p1', 'p2', 'p2')],
    }
    const table = computeTable(state)

    expect(table.map(row => row.playerId)).toEqual(['p2', 'p1'])
    expect(table.map(row => row.place)).toEqual([1, 2])
    expect(table.every(row => !row.tied)).toBe(true)
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

  it('shares a place among three that are level (no direct comparison for more than two)', () => {
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

  it('does not count a duel that is not done', () => {
    const state: DuelsState = { players: players(2), duels: [duel('p1', 'p2'), duel('p1', 'p2', { status: 'running' })] }

    expect(computeTable(state).map(row => row.played)).toEqual([0, 0])
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
