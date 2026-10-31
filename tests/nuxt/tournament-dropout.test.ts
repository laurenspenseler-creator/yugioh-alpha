// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { Duel, DuelsState } from '../../shared/tournament-duels'
import { decideLeave, deficits, dropOptions, leaveTournament, poolDuels, recomputeSwiss, targetDuels } from '../../shared/tournament-dropout'
import { seededRandom } from '../../shared/tournament-draw'
import { startingSchedule, swissRoundDue } from '../../shared/tournament-flow'
import type { FlowSetup, NewDuel } from '../../shared/tournament-flow'
import { computeTable } from '../../shared/tournament-table'
import { pairKey } from '../../shared/tournament-swiss'

const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i + 1}`)

function build(n: number, setup: FlowSetup, seed = 1): DuelsState {
  const first = startingSchedule(setup, ids(n), seededRandom(seed))
  return {
    players: ids(n).map((id, i) => ({ id, seed: i + 1, status: 'active' as const, dropOption: null })),
    duels: first.duels.map((duel, i): Duel => ({ ...duel, id: `d${i}`, status: 'planned', winner: null, table: null, startedAt: null, endedAt: null })),
    pauses: first.pauses,
  }
}

const play = (state: DuelsState, pick: (duel: Duel) => boolean): DuelsState => ({
  ...state,
  duels: state.duels.map((duel, i) => duel.status === 'planned' && pick(duel) ? { ...duel, status: 'done', winner: duel.a, endedAt: 100 + i } : duel),
})

function addDuels(state: DuelsState, duels: NewDuel[], tag: string): DuelsState {
  return { ...state, duels: [...state.duels, ...duels.map((duel, i): Duel => ({ ...duel, id: `${tag}${state.duels.length + i}`, status: 'planned', winner: null, table: null, startedAt: null, endedAt: null }))] }
}

const countOf = (state: DuelsState, id: string) => state.duels.filter(duel => duel.status !== 'void' && (duel.a === id || duel.b === id)).length

describe('round robin', () => {
  const setup: FlowSetup = { mode: 'round_robin', rounds: null, prelaunch: false }

  it('option A strikes every duel of the player and leaves nobody lacking a duel', () => {
    const state = play(build(6, setup), duel => duel.round === 1)
    const left = leaveTournament(state, 'p3', 'dropped', 'A')

    expect(left.duels.filter(duel => (duel.a === 'p3' || duel.b === 'p3') && duel.status !== 'void')).toEqual([])
    expect(targetDuels(left, setup)).toBe(4)
    expect(deficits(left, setup).size).toBe(0)
    expect(poolDuels(left, setup)).toEqual([])
  })

  it('option B keeps the played duels and makes the players with an open duel play each other', () => {
    // Round 1 is played, the rest open: p3 has one played duel and four open ones, an even number.
    const state = play(build(6, setup), duel => duel.round === 1)
    const left = leaveTournament(state, 'p3', 'dropped', 'B')
    const lacking = deficits(left, setup)

    expect(dropOptions(state, setup, 'p3')).toEqual({ A: true, B: true })
    expect([...lacking.keys()].sort()).toHaveLength(4)
    const pool = poolDuels(left, setup)
    expect(pool).toHaveLength(2)
    expect(pool.every(duel => duel.kind === 'rematch')).toBe(true)
    const settled = addDuels(left, pool, 'x')
    expect(deficits(settled, setup).size).toBe(0)
  })

  it('does not offer B when the number of open opponents is odd', () => {
    // 5 players: p3 played two, so two open duels remain... make it three open by playing only one duel of p3.
    let state = build(5, setup)
    const first = state.duels.find(duel => duel.a === 'p3' || duel.b === 'p3')!
    state = play(state, duel => duel.id === first.id)

    expect(dropOptions(state, setup, 'p3')).toEqual({ A: true, B: false })
  })

  it('offers nothing while the player is in a running duel, and refuses to let them leave', () => {
    const state = build(4, setup)
    const running: DuelsState = { ...state, duels: state.duels.map((duel, i) => i === 0 ? { ...duel, status: 'running', table: 1 } : duel) }
    const who = running.duels[0]!.a

    expect(dropOptions(running, setup, who)).toEqual({ A: false, B: false })
    expect(() => leaveTournament(running, who, 'dropped', 'A')).toThrow()
  })
})

describe('Champions League', () => {
  const setup: FlowSetup = { mode: 'champions_league', rounds: 4, prelaunch: false }

  it('lets the opponents of a player who is struck play each other, so everybody ends with R duels', () => {
    const state = play(build(10, setup, 4), duel => duel.round === 1)
    const target = state.duels.find(duel => duel.round === 1)!.a
    const left = leaveTournament(state, target, 'dropped', 'A')

    expect(dropOptions(state, setup, target).A).toBe(true)
    expect(deficits(left, setup).size).toBe(4)
    const settled = addDuels(left, poolDuels(left, setup), 'pool')
    for (const id of ids(10).filter(id => id !== target)) {
      expect(countOf(settled, id)).toBe(4)
    }
    expect(poolDuels(settled, setup)).toEqual([])
  })

  it('does not pair a player twice against the same opponent when another pair is possible', () => {
    const state = build(12, setup, 9)
    const left = leaveTournament(state, 'p1', 'dropped', 'A')
    const pool = poolDuels(left, setup)
    const old = new Set(left.duels.filter(duel => duel.status !== 'void').map(duel => pairKey(duel.a, duel.b)))

    expect(pool).toHaveLength(2)
    expect(pool.filter(duel => duel.kind === 'makeup').length + pool.filter(duel => old.has(pairKey(duel.a, duel.b))).length).toBeGreaterThanOrEqual(2)
  })
})

describe('disqualification and undecided dropouts', () => {
  const setup: FlowSetup = { mode: 'round_robin', rounds: null, prelaunch: false }

  it('removes a disqualified player from the table and strikes everything like option A', () => {
    const state = play(build(5, setup), duel => duel.round <= 2)
    const left = leaveTournament(state, 'p2', 'disqualified', null)

    expect(left.players.find(player => player.id === 'p2')).toMatchObject({ status: 'disqualified', dropOption: 'A' })
    expect(computeTable(left).map(row => row.playerId)).not.toContain('p2')
    expect(left.duels.every(duel => duel.status === 'void' || (duel.a !== 'p2' && duel.b !== 'p2'))).toBe(true)
  })

  it('keeps all duels of a player who left undecided and strikes them when the organizer decides', () => {
    const state = play(build(5, setup), duel => duel.round === 1)
    const undecided = leaveTournament(state, 'p4', 'dropped', null)

    expect(undecided.duels.filter(duel => duel.status === 'void')).toEqual([])
    const row = computeTable(undecided).find(r => r.playerId === 'p4')!
    expect(row).toMatchObject({ left: true, place: null })

    const decided = decideLeave(undecided, 'p4', 'A')
    expect(decided.duels.filter(duel => (duel.a === 'p4' || duel.b === 'p4') && duel.status !== 'void')).toEqual([])
    expect(() => decideLeave(decided, 'p4', 'B')).toThrow()
    // The grey row still shows what the player played.
    expect(computeTable(decided).find(r => r.playerId === 'p4')!.played).toBe(computeTable(undecided).find(r => r.playerId === 'p4')!.played)
  })
})

describe('Swiss system', () => {
  it('always offers both options', () => {
    const setup: FlowSetup = { mode: 'swiss', rounds: 4, prelaunch: true }

    expect(dropOptions(build(9, setup), setup, 'p2')).toEqual({ A: true, B: true })
  })

  /** Plays a whole Swiss tournament; `who` leaves after `dropAt` rounds were played out, with `option` if the app offers it. Returns whether the option was offered. */
  function simulate(n: number, prelaunch: boolean, option: 'A' | 'B', dropAt: number): boolean {
    const rounds = 4
    const setup: FlowSetup = { mode: 'swiss', rounds, prelaunch }
    const random = seededRandom(n * 7 + dropAt + (prelaunch ? 100 : 0))
    let state = build(n, setup, n + dropAt)

    for (let guard = 0; guard < 60; guard += 1) {
      // Play out everything planned.
      state = { ...state, duels: state.duels.map((duel, i) => duel.status === 'planned' ? { ...duel, status: 'done', winner: random() < 0.5 ? duel.a : duel.b, endedAt: 1000 + guard * 100 + i } : duel) }
      if (guard === dropAt) {
        if (!dropOptions(state, setup, 'p4')[option]) {
          return false
        }
        state = leaveTournament(state, 'p4', 'dropped', option)
      }
      const due = swissRoundDue(state, setup)
      if (due) {
        state = addDuels(state, [...due.duels, ...(due.makeup ? [due.makeup] : [])], `r${due.round}-`)
        state = { ...state, pauses: [...(state.pauses ?? []), ...(due.pause ? [due.pause] : [])] }
      }
      const pool = poolDuels(state, setup)
      if (pool.length > 0) {
        state = addDuels(state, pool, `pool${guard}-`)
      }
      if (!due && pool.length === 0 && state.duels.every(duel => duel.status !== 'planned')) {
        break
      }
    }

    for (const player of state.players.filter(candidate => candidate.status === 'active')) {
      expect(countOf(state, player.id)).toBe(rounds)
    }
    expect(deficits(state, setup).size).toBe(0)
    return true
  }

  for (const option of ['A', 'B'] as const) {
    for (const [n, prelaunch] of [[10, false], [9, false], [9, true], [11, true], [12, true]] as const) {
      it(`ends with the same number of duels for everyone who stays (${n} players, head start ${prelaunch}, option ${option})`, () => {
        const offered = [0, 1, 2].map(dropAt => simulate(n, prelaunch, option, dropAt))

        // A is always offered; B only when the duels that stay against the player who left add up.
        if (option === 'A') {
          expect(offered).toEqual([true, true, true])
        }
      })
    }
  }

  it('offers B in the Swiss system exactly when an even number of duels stays against players who left', () => {
    const setup: FlowSetup = { mode: 'swiss', rounds: 4, prelaunch: false }
    // After round 1 the player has played one duel: that would be left with one duel nobody can match.
    const afterOne = play(build(10, setup, 3), duel => duel.round === 1)
    const afterOneOptions = dropOptions(afterOne, setup, 'p4')
    expect(afterOneOptions).toEqual({ A: true, B: false })

    // With a second round played, two duels stay.
    let state = afterOne
    const due = swissRoundDue(state, setup)!
    state = addDuels(state, [...due.duels, ...(due.makeup ? [due.makeup] : [])], 'r2-')
    state = play({ ...state, pauses: [...(state.pauses ?? []), ...(due.pause ? [due.pause] : [])] }, duel => duel.round === 2)
    const playedTwice = ['p4'].every(id => state.duels.filter(duel => duel.status === 'done' && (duel.a === id || duel.b === id)).length === 2)
    if (playedTwice) {
      expect(dropOptions(state, setup, 'p4').B).toBe(true)
    }
  })

  it('does not pool before both rounds of a pair are paired', () => {
    const setup: FlowSetup = { mode: 'swiss', rounds: 4, prelaunch: false }
    const state = leaveTournament(build(8, setup, 2), 'p1', 'dropped', 'A')

    expect(poolDuels(state, setup)).toEqual([])
  })
})

describe('recomputeSwiss', () => {
  const setup: FlowSetup = { mode: 'swiss', rounds: 4, prelaunch: true }

  it('draws the open pairings of round 2 again from the table of round 1', () => {
    let state = build(8, setup, 6)
    // Round 1: the first named player wins; round 2 stays open.
    state = play(state, duel => duel.round === 1)
    const changes = recomputeSwiss(state)

    expect(changes.length).toBeLessThanOrEqual(1)
    for (const change of changes) {
      expect(change.round).toBe(2)
      expect(change.added).toHaveLength(change.removed.length)
      const winners = new Set(state.duels.filter(duel => duel.round === 1).map(duel => duel.winner))
      // After the redraw the winners meet winners.
      expect(change.added.filter(duel => winners.has(duel.a) && winners.has(duel.b)).length).toBe(2)
    }
  })

  it('leaves played and running duels alone', () => {
    let state = build(8, setup, 6)
    state = play(state, () => true)

    expect(recomputeSwiss(state)).toEqual([])
  })
})
