// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { Duel, DuelsState, Pause } from '../../shared/tournament-duels'
import { seededRandom } from '../../shared/tournament-draw'
import { pairSwissRound, startingSchedule, swissRoundDue } from '../../shared/tournament-flow'
import type { FlowSetup, NewDuel } from '../../shared/tournament-flow'
import { pairKey } from '../../shared/tournament-swiss'
import { swissRounds } from '../../shared/tournament-modes'

const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i + 1}`)

function stateOf(n: number, duels: NewDuel[], pauses: Pause[] = []): DuelsState {
  return {
    players: ids(n).map((id, i) => ({ id, seed: i + 1, status: 'active' as const, dropOption: null })),
    duels: duels.map((duel, i): Duel => ({ ...duel, id: `d${i}`, status: 'planned', winner: null, table: null, startedAt: null, endedAt: null })),
    pauses,
  }
}

/** Plays every planned duel of the given round(s); the first player of each pair wins unless `pick` says otherwise. */
function finish(state: DuelsState, upTo: number, pick: (duel: Duel) => string = duel => duel.a): DuelsState {
  return {
    ...state,
    duels: state.duels.map(duel => duel.status === 'planned' && duel.round <= upTo ? { ...duel, status: 'done', winner: pick(duel), endedAt: 1000 } : duel),
  }
}

function duelsOf(state: DuelsState, playerId: string): number {
  return state.duels.filter(duel => duel.status !== 'void' && (duel.a === playerId || duel.b === playerId)).length
}

describe('startingSchedule', () => {
  it('fixes every duel of a round robin once', () => {
    const { duels, pauses } = startingSchedule({ mode: 'round_robin', rounds: null, prelaunch: false }, ids(6))

    expect(duels).toHaveLength(15)
    expect(new Set(duels.map(duel => pairKey(duel.a, duel.b))).size).toBe(15)
    expect(pauses).toEqual([])
    expect(Math.max(...duels.map(duel => duel.round))).toBeLessThanOrEqual(5)
  })

  it('fixes the Champions League with the same number of duels for every player and no rematch', () => {
    const { duels } = startingSchedule({ mode: 'champions_league', rounds: 4, prelaunch: false }, ids(8), seededRandom(7))
    const state = stateOf(8, duels)

    expect(duels).toHaveLength(16)
    expect(new Set(duels.map(duel => pairKey(duel.a, duel.b))).size).toBe(16)
    for (const id of ids(8)) {
      expect(duelsOf(state, id)).toBe(4)
    }
  })

  it('draws only round 1 of a classic Swiss tournament', () => {
    const { duels, pauses } = startingSchedule({ mode: 'swiss', rounds: 4, prelaunch: false }, ids(8), seededRandom(3))

    expect(duels).toHaveLength(4)
    expect(duels.every(duel => duel.round === 1)).toBe(true)
    expect(pauses).toEqual([])
  })

  it('pairs rounds 1 and 2 before the start with a head start, without a rematch', () => {
    const { duels } = startingSchedule({ mode: 'swiss', rounds: 4, prelaunch: true }, ids(8), seededRandom(3))
    const keys = duels.map(duel => pairKey(duel.a, duel.b))

    expect(duels.filter(duel => duel.round === 1)).toHaveLength(4)
    expect(duels.filter(duel => duel.round === 2)).toHaveLength(4)
    expect(new Set(keys).size).toBe(8)
  })

  it('lets one player pause in each of rounds 1 and 2 with an odd field, and makes the pauses up against each other', () => {
    const { duels, pauses } = startingSchedule({ mode: 'swiss', rounds: 4, prelaunch: true }, ids(7), seededRandom(11))
    const state = stateOf(7, duels, pauses)

    expect(pauses).toHaveLength(2)
    expect(pauses[0]!.playerId).not.toBe(pauses[1]!.playerId)
    const makeup = duels.filter(duel => duel.kind === 'makeup' || duel.kind === 'rematch')
    expect(makeup).toHaveLength(1)
    expect([makeup[0]!.a, makeup[0]!.b].sort()).toEqual(pauses.map(pause => pause.playerId).sort())
    // After rounds 1 + 2 everybody has two duels, so the table can be compared.
    for (const id of ids(7)) {
      expect(duelsOf(state, id)).toBe(2)
    }
  })
})

describe('pairSwissRound', () => {
  const setup: FlowSetup = { mode: 'swiss', rounds: 4, prelaunch: false }

  it('pairs winners with winners and never repeats a duel', () => {
    const { duels } = startingSchedule(setup, ids(8), seededRandom(5))
    const afterOne = finish(stateOf(8, duels), 1)
    const wins = new Set(afterOne.duels.map(duel => duel.winner))
    const next = pairSwissRound(afterOne, 2)

    expect(next.duels).toHaveLength(4)
    const met = new Set(duels.map(duel => pairKey(duel.a, duel.b)))
    for (const duel of next.duels) {
      expect(met.has(pairKey(duel.a, duel.b))).toBe(false)
    }
    const winnerPairs = next.duels.filter(duel => wins.has(duel.a) && wins.has(duel.b))
    expect(winnerPairs).toHaveLength(2)
  })

  it('lets the player who sat out once not sit out again while another has not', () => {
    const { duels, pauses } = startingSchedule(setup, ids(7), seededRandom(2))
    const afterOne = finish(stateOf(7, duels, pauses), 1)
    const next = pairSwissRound(afterOne, 2)

    expect(next.pause).not.toBeNull()
    expect(next.pause!.playerId).not.toBe(pauses[0]!.playerId)
    expect(next.duels).toHaveLength(3)
  })
})

describe('swissRoundDue', () => {
  it('waits for round k before it pairs round k + 1 in the classic system', () => {
    const setup: FlowSetup = { mode: 'swiss', rounds: 4, prelaunch: false }
    const { duels, pauses } = startingSchedule(setup, ids(8), seededRandom(9))
    const state = stateOf(8, duels, pauses)

    expect(swissRoundDue(state, setup)).toBeNull()
    const almost = { ...finish(state, 1), duels: finish(state, 1).duels.map((duel, i) => i === 0 ? { ...duel, status: 'running' as const, winner: null } : duel) }
    expect(swissRoundDue(almost, setup)).toBeNull()
    expect(swissRoundDue(finish(state, 1), setup)?.round).toBe(2)
  })

  it('pairs round k + 2 as soon as round k is complete with a head start', () => {
    const setup: FlowSetup = { mode: 'swiss', rounds: 4, prelaunch: true }
    const { duels, pauses } = startingSchedule(setup, ids(8), seededRandom(9))
    const state = stateOf(8, duels, pauses)

    expect(swissRoundDue(state, setup)).toBeNull()
    const roundOne = { ...state, duels: state.duels.map(duel => duel.round === 1 ? { ...duel, status: 'done' as const, winner: duel.a, endedAt: 1 } : duel) }
    expect(swissRoundDue(roundOne, setup)?.round).toBe(3)
  })

  it('stops after the last round and never applies to the other modes', () => {
    const swiss: FlowSetup = { mode: 'swiss', rounds: 2, prelaunch: false }
    const { duels, pauses } = startingSchedule(swiss, ids(8), seededRandom(1))
    const afterOne = finish(stateOf(8, duels, pauses), 1)
    const two = pairSwissRound(afterOne, 2)
    const all = finish({ ...afterOne, duels: [...afterOne.duels, ...stateOf(8, two.duels).duels.map((d, i) => ({ ...d, id: `n${i}` }))] }, 2)

    expect(swissRoundDue(all, swiss)).toBeNull()
    expect(swissRoundDue(stateOf(8, []), { mode: 'round_robin', rounds: null, prelaunch: false })).toBeNull()
  })
})

describe('a whole Swiss tournament', () => {
  // Plays every round out with seeded random winners and checks what the spec promises: no rematch, and after the last
  // round every player has played exactly R duels (the pauses made up).
  for (const prelaunch of [false, true]) {
    for (const n of [5, 6, 7, 8, 9, 10, 13]) {
      it(`${n} players, ${prelaunch ? 'with' : 'without'} a head start, ends even and without a rematch`, () => {
        const rounds = swissRounds(n, prelaunch)
        const setup: FlowSetup = { mode: 'swiss', rounds, prelaunch }
        const random = seededRandom(n * 31 + (prelaunch ? 1 : 0))
        const first = startingSchedule(setup, ids(n), random)
        let state = stateOf(n, first.duels, first.pauses)

        for (let guard = 0; guard < 40; guard += 1) {
          // Play everything that is planned, in one go, then see what the next round brings.
          const open = state.duels.filter(duel => duel.status === 'planned')
          if (open.length === 0) {
            const due = swissRoundDue(state, setup)
            if (!due) {
              break
            }
          }
          state = {
            ...state,
            duels: state.duels.map((duel, i) => duel.status === 'planned' ? { ...duel, status: 'done', winner: random() < 0.5 ? duel.a : duel.b, endedAt: 1000 + i } : duel),
          }
          const due = swissRoundDue(state, setup)
          if (due) {
            const fresh: Duel[] = [...due.duels, ...(due.makeup ? [due.makeup] : [])].map((duel, i) => ({ ...duel, id: `r${due.round}-${i}`, status: 'planned', winner: null, table: null, startedAt: null, endedAt: null }))
            state = { ...state, duels: [...state.duels, ...fresh], pauses: [...(state.pauses ?? []), ...(due.pause ? [due.pause] : [])] }
          }
        }

        const regular = state.duels.filter(duel => duel.kind === 'regular')
        const keys = regular.map(duel => pairKey(duel.a, duel.b))
        expect(new Set(keys).size).toBe(keys.length)
        for (const id of ids(n)) {
          expect(duelsOf(state, id)).toBe(rounds)
        }
      })
    }
  }
})
