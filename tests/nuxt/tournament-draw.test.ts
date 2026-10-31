// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { championsLeagueDraw, matchdaysOf, roundRobinDuels, seededRandom, shuffled } from '../../shared/tournament-draw'
import type { DrawnDuel } from '../../shared/tournament-draw'

const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i + 1}`)
const key = (duel: DrawnDuel) => [duel.a, duel.b].sort().join('|')

/** How many duels each player has. */
function perPlayer(duels: DrawnDuel[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const duel of duels) {
    counts.set(duel.a, (counts.get(duel.a) ?? 0) + 1)
    counts.set(duel.b, (counts.get(duel.b) ?? 0) + 1)
  }
  return counts
}

describe('seededRandom', () => {
  it('gives the same numbers for the same seed and others for another', () => {
    const a = seededRandom(7)
    const b = seededRandom(7)
    const first = [a(), a(), a()]

    expect([b(), b(), b()]).toEqual(first)
    expect(first.every(value => value >= 0 && value < 1)).toBe(true)
    expect(seededRandom(8)()).not.toBe(first[0])
  })
})

describe('shuffled', () => {
  it('keeps every item once and leaves the input alone', () => {
    const input = ids(10)
    const out = shuffled(input, seededRandom(3))

    expect([...out].sort()).toEqual([...input].sort())
    expect(input).toEqual(ids(10))
    expect(out).not.toEqual(input)
  })
})

describe('roundRobinDuels', () => {
  it('has every pair once: n (n - 1) / 2 duels', () => {
    for (const n of [2, 3, 4, 7, 10, 22]) {
      const duels = roundRobinDuels(ids(n))

      expect(duels).toHaveLength(n * (n - 1) / 2)
      expect(new Set(duels.map(key)).size).toBe(duels.length)
    }
  })

  it('has no duel against nobody for an odd number of players', () => {
    expect(roundRobinDuels(ids(5)).every(duel => duel.a && duel.b)).toBe(true)
  })
})

describe('championsLeagueDraw', () => {
  it('gives every player exactly R different opponents: n R / 2 duels, no pair twice', () => {
    for (const [n, rounds] of [[8, 2], [8, 6], [9, 8], [10, 4], [22, 6], [22, 20], [3, 2], [2, 0]] as const) {
      const duels = championsLeagueDraw(ids(n), rounds, seededRandom(n * 100 + rounds))

      expect(duels, `${n} players, ${rounds} rounds`).toHaveLength(n * rounds / 2)
      expect(new Set(duels.map(key)).size).toBe(duels.length)
      expect(duels.every(duel => duel.a !== duel.b)).toBe(true)
      for (const player of ids(n)) {
        expect(perPlayer(duels).get(player) ?? 0, `${player} of ${n}/${rounds}`).toBe(rounds)
      }
    }
  })

  it('is a random draw: another seed gives other pairs, the same seed the same ones', () => {
    const a = championsLeagueDraw(ids(12), 4, seededRandom(1)).map(key)

    expect(championsLeagueDraw(ids(12), 4, seededRandom(1)).map(key)).toEqual(a)
    expect(championsLeagueDraw(ids(12), 4, seededRandom(2)).map(key)).not.toEqual(a)
  })

  it('refuses a number of rounds that cannot work', () => {
    expect(() => championsLeagueDraw(ids(6), 3)).toThrow(RangeError)
    expect(() => championsLeagueDraw(ids(6), 6)).toThrow(RangeError)
    expect(() => championsLeagueDraw(ids(6), -2)).toThrow(RangeError)
  })
})

describe('matchdaysOf', () => {
  it('puts nobody on the same day twice', () => {
    for (const duels of [roundRobinDuels(ids(9)), championsLeagueDraw(ids(22), 6, seededRandom(4))]) {
      const days = matchdaysOf(duels)
      const seen = new Set<string>()

      duels.forEach((duel, i) => {
        for (const player of [duel.a, duel.b]) {
          expect(seen.has(`${days[i]}:${player}`)).toBe(false)
          seen.add(`${days[i]}:${player}`)
        }
      })
    }
  })

  it('needs about as many days as a player has duels', () => {
    const rounds = 6
    const days = matchdaysOf(championsLeagueDraw(ids(22), rounds, seededRandom(4)))

    expect(Math.max(...days)).toBeLessThanOrEqual(rounds + 3)
    expect(Math.min(...days)).toBe(1)
  })

  it('has a day for every duel and none for no duels', () => {
    expect(matchdaysOf([])).toEqual([])
    expect(matchdaysOf(roundRobinDuels(ids(6)))).toHaveLength(15)
  })
})
