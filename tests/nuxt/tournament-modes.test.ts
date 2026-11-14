// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  defaultRounds,
  duelsPerPlayer,
  estimateMinutes,
  isFreeMode,
  matchdayCount,
  maxEvenRounds,
  recommendedMode,
  roundRobinDuelCount,
  roundsForDuration,
  splitMinutes,
  swissRounds,
  totalDuels,
  usableTables,
  validateSetup,
} from '../../shared/tournament-modes'
import type { SetupInput } from '../../shared/tournament-modes'

const setup = (patch: Partial<SetupInput> = {}): SetupInput => ({ mode: 'champions_league', players: 22, rounds: 6, tables: 5, duelMinutes: 30, ...patch })

describe('duel counts', () => {
  it('counts a round robin as n (n - 1) / 2: 10 players 45 duels, 22 players 231', () => {
    expect(roundRobinDuelCount(10)).toBe(45)
    expect(roundRobinDuelCount(22)).toBe(231)
    expect(roundRobinDuelCount(1)).toBe(0)
  })

  it('gives a round robin player all the others and the other modes the chosen rounds', () => {
    expect(duelsPerPlayer({ mode: 'round_robin', players: 8, rounds: null })).toBe(7)
    expect(duelsPerPlayer({ mode: 'champions_league', players: 22, rounds: 6 })).toBe(6)
    expect(totalDuels({ mode: 'champions_league', players: 22, rounds: 6 })).toBe(66)
    expect(totalDuels({ mode: 'round_robin', players: 22, rounds: null })).toBe(231)
  })
})

describe('usableTables', () => {
  it('is no more than half the players, and at least one', () => {
    expect(usableTables(5, 22)).toBe(5)
    expect(usableTables(8, 6)).toBe(3)
    expect(usableTables(3, 2)).toBe(1)
  })
})

describe('estimateMinutes (the figures of the spec: 22 players, 5 tables, 30 minutes)', () => {
  it('Champions League with 6 rounds: about 7.1 hours', () => {
    expect(estimateMinutes(setup()) / 60).toBeCloseTo(7.1, 1)
  })

  it('Swiss with a head start with 6 rounds: the same, 7.1 hours', () => {
    expect(estimateMinutes(setup({ mode: 'swiss', prelaunch: true })) / 60).toBeCloseTo(7.1, 1)
  })

  it('classic Swiss with 6 rounds waits for every round: about 9.5 hours', () => {
    expect(estimateMinutes(setup({ mode: 'swiss', prelaunch: false })) / 60).toBeCloseTo(9.5, 1)
  })

  it('round robin: 21 rounds, about 23.6 hours', () => {
    expect(estimateMinutes(setup({ mode: 'round_robin', rounds: null })) / 60).toBeCloseTo(23.6, 1)
  })

  it('uses only as many tables as there are pairs of players', () => {
    expect(estimateMinutes(setup({ players: 4, rounds: 2, tables: 10 }))).toBe(estimateMinutes(setup({ players: 4, rounds: 2, tables: 2 })))
  })
})

describe('roundsForDuration', () => {
  it('turns 5 hours into 4 rounds for 22 players (about 4.9 hours)', () => {
    const rounds = roundsForDuration({ mode: 'champions_league', players: 22, tables: 5, duelMinutes: 30 }, 300)

    expect(rounds).toBe(4)
    expect(estimateMinutes(setup({ rounds })) / 60).toBeCloseTo(4.9, 1)
  })

  it('stays even, at least 2 and not above the others a player can meet', () => {
    expect(roundsForDuration({ mode: 'swiss', players: 22, tables: 5, duelMinutes: 30 }, 10)).toBe(2)
    expect(roundsForDuration({ mode: 'champions_league', players: 6, tables: 3, duelMinutes: 30 }, 100_000)).toBe(4)
    expect(roundsForDuration({ mode: 'champions_league', players: 7, tables: 3, duelMinutes: 30 }, 100_000)).toBe(6)
  })
})

describe('swissRounds', () => {
  it('is log2 of the players rounded up, one more with a head start, made even: 22 players 6 either way', () => {
    expect(swissRounds(22, false)).toBe(6)
    expect(swissRounds(22, true)).toBe(6)
    expect(swissRounds(8, false)).toBe(4)
    expect(swissRounds(8, true)).toBe(4)
    expect(swissRounds(16, false)).toBe(4)
    expect(swissRounds(2, false)).toBe(2)
  })
})

describe('maxEvenRounds', () => {
  it('is the highest even number not above n - 1', () => {
    expect(maxEvenRounds(10)).toBe(8)
    expect(maxEvenRounds(9)).toBe(8)
    expect(maxEvenRounds(2)).toBe(0)
  })
})

describe('validateSetup', () => {
  const codes = (input: SetupInput) => validateSetup(input).map(issue => issue.code)

  it('accepts the setup of the example', () => {
    expect(codes(setup())).toEqual([])
    expect(codes(setup({ mode: 'swiss', prelaunch: true }))).toEqual([])
    expect(codes(setup({ mode: 'round_robin', rounds: null }))).toEqual([])
  })

  it('wants an even number of rounds for Champions League and Swiss', () => {
    expect(codes(setup({ rounds: 5 }))).toEqual(['rounds_must_be_even'])
    expect(codes(setup({ mode: 'swiss', rounds: 3 }))).toEqual(['rounds_must_be_even'])
  })

  it('does not give a player more different opponents than there are others', () => {
    expect(validateSetup(setup({ players: 6, rounds: 6 }))).toEqual([{ code: 'rounds_too_large', params: { max: 5 } }])
    expect(codes(setup({ players: 6, rounds: 4 }))).toEqual([])
  })

  it('asks for rounds where the mode needs them, and for at least two', () => {
    expect(codes(setup({ rounds: null }))).toEqual(['rounds_missing'])
    expect(codes(setup({ rounds: 0 }))).toEqual(['rounds_too_small'])
  })

  it('wants two players, a table and a duel length', () => {
    expect(codes(setup({ players: 1, rounds: 2 }))).toContain('too_few_players')
    expect(codes(setup({ tables: 0 }))).toEqual(['tables_invalid'])
    expect(codes(setup({ duelMinutes: 0 }))).toEqual(['duel_minutes_invalid'])
  })

  it('leaves the rounds of a round robin alone', () => {
    expect(codes(setup({ mode: 'round_robin', rounds: 999 }))).toEqual([])
  })
})

describe('recommendedMode', () => {
  it('suggests a round robin for small groups, Champions League for middle ones and Swiss for large ones', () => {
    expect(recommendedMode(6)).toBe('round_robin')
    expect(recommendedMode(16)).toBe('champions_league')
    expect(recommendedMode(40)).toBe('swiss')
  })
})

describe('splitMinutes', () => {
  it('splits a duration into hours and minutes', () => {
    expect(splitMinutes(426)).toEqual({ hours: 7, minutes: 6 })
    expect(splitMinutes(-5)).toEqual({ hours: 0, minutes: 0 })
  })
})

describe('Spieltage (the flow "rounds")', () => {
  it('counts the days: n - 1 for a round robin (n when the field is odd), R for the others', () => {
    expect(matchdayCount({ mode: 'round_robin', players: 8, rounds: null })).toBe(7)
    expect(matchdayCount({ mode: 'round_robin', players: 7, rounds: null })).toBe(7)
    expect(matchdayCount({ mode: 'champions_league', players: 11, rounds: 6 })).toBe(6)
    expect(matchdayCount({ mode: 'swiss', players: 11, rounds: 4 })).toBe(4)
  })

  it('takes one duel per day, whatever the number of tables', () => {
    expect(estimateMinutes(setup({ flow: 'rounds', players: 11, rounds: 6, tables: 1, duelMinutes: 20 }))).toBe(120)
    expect(estimateMinutes(setup({ flow: 'rounds', mode: 'round_robin', rounds: null, players: 8, tables: 2, duelMinutes: 30 }))).toBe(210)
  })

  it('does not ask for tables', () => {
    expect(validateSetup(setup({ flow: 'rounds', tables: 0 })).map(issue => issue.code)).toEqual([])
    expect(validateSetup(setup({ flow: 'queue', tables: 0 })).map(issue => issue.code)).toEqual(['tables_invalid'])
  })

  it('turns a wished duration into days', () => {
    // 3 hours of 30-minute days: 6 days, an even number.
    expect(roundsForDuration({ mode: 'champions_league', players: 22, tables: 5, duelMinutes: 30, flow: 'rounds' }, 180)).toBe(6)
  })
})

describe('the Spielabend (mode "free")', () => {
  const codes = (input: SetupInput) => validateSetup(input).map(issue => issue.code)

  it('is the only free mode', () => {
    expect(isFreeMode('free')).toBe(true)
    expect(isFreeMode('swiss')).toBe(false)
    expect(isFreeMode(null)).toBe(false)
  })

  it('needs two players and nothing else: no rounds, no tables, no duel length', () => {
    expect(codes(setup({ mode: 'free', players: 2, rounds: null, tables: 0, duelMinutes: 0 }))).toEqual([])
    expect(codes(setup({ mode: 'free', players: 1, rounds: null }))).toEqual(['too_few_players'])
  })

  it('has no number of rounds of its own', () => {
    expect(defaultRounds('free', 8, false)).toBeNull()
    expect(defaultRounds('free', 8, true)).toBeNull()
  })
})