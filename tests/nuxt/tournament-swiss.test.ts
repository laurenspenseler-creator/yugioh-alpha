// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { seededRandom } from '../../shared/tournament-draw'
import { pairKey, pairPlayers } from '../../shared/tournament-swiss'
import type { PairablePlayer } from '../../shared/tournament-swiss'

function player(id: string, score: number, rank: number, extra: Partial<PairablePlayer> = {}): PairablePlayer {
  return { id, score, rank, opponents: new Set(), pauses: 0, ...extra }
}

/** `n` players p1..pn, ranked by their number, with the given scores. */
function field(scores: number[], extra: (index: number) => Partial<PairablePlayer> = () => ({})): PairablePlayer[] {
  return scores.map((score, i) => player(`p${i + 1}`, score, i + 1, extra(i)))
}

describe('pairKey', () => {
  it('does not depend on the order', () => {
    expect(pairKey('a', 'b')).toBe(pairKey('b', 'a'))
    expect(pairKey('a', 'b')).not.toBe(pairKey('a', 'c'))
  })
})

describe('pairPlayers (even field)', () => {
  it('pairs players with the same record', () => {
    // p1 and p4 have 2 wins, p2 and p3 one, p5 and p6 none.
    const result = pairPlayers(field([2, 1, 1, 2, 0, 0]))
    const pairs = result.pairs.map(pair => pairKey(pair.a, pair.b)).sort()

    expect(pairs).toEqual([pairKey('p1', 'p4'), pairKey('p2', 'p3'), pairKey('p5', 'p6')].sort())
    expect(result.pause).toBeNull()
    expect(result.unpaired).toEqual([])
  })

  it('pairs everybody and nobody twice', () => {
    const result = pairPlayers(field([3, 3, 2, 2, 1, 1, 0, 0]))
    const seen = result.pairs.flatMap(pair => [pair.a, pair.b])

    expect(seen).toHaveLength(8)
    expect(new Set(seen).size).toBe(8)
  })

  it('does not repeat a duel when another pairing is possible, even if the record would match better', () => {
    // p1 and p2 have met; the best match by record would be p1-p2 and p3-p4.
    const players = field([2, 2, 1, 1], i => ({ opponents: new Set(i === 0 ? ['p2'] : i === 1 ? ['p1'] : []) }))
    const result = pairPlayers(players)

    expect(result.pairs.map(pair => pairKey(pair.a, pair.b))).not.toContain(pairKey('p1', 'p2'))
    expect(result.pairs).toHaveLength(2)
    expect(result.pairs.every(pair => !pair.rematch)).toBe(true)
  })

  it('does not run into a dead end where pairing from the top down would', () => {
    // p1 met p2 and p3, p4 met p5 and p6, p2 met p3 and p5; greedy from the top picks p1-p4 and then
    // p2-p3 fails. A perfect matching exists: p1-p4? p1-p5, p2-p6... the matcher has to find one.
    const met = (id: string, others: string[]) => new Set(others)
    const players = [
      player('p1', 3, 1, { opponents: met('p1', ['p2', 'p3']) }),
      player('p2', 2, 2, { opponents: met('p2', ['p1', 'p3', 'p5']) }),
      player('p3', 2, 3, { opponents: met('p3', ['p1', 'p2']) }),
      player('p4', 1, 4, { opponents: met('p4', ['p5', 'p6']) }),
      player('p5', 1, 5, { opponents: met('p5', ['p4', 'p2']) }),
      player('p6', 0, 6, { opponents: met('p6', ['p4']) }),
    ]
    const result = pairPlayers(players)

    expect(result.unpaired).toEqual([])
    expect(result.pairs).toHaveLength(3)
    for (const pair of result.pairs) {
      expect(players.find(p => p.id === pair.a)!.opponents.has(pair.b)).toBe(false)
    }
  })

  it('keeps pairs that are already fixed out', () => {
    const forbidden = new Set([pairKey('p1', 'p2'), pairKey('p3', 'p4')])
    const result = pairPlayers(field([1, 1, 1, 1]), { forbidden })

    const pairs = result.pairs.map(pair => pairKey(pair.a, pair.b))

    expect(pairs).toHaveLength(2)
    expect(pairs).not.toContain(pairKey('p1', 'p2'))
    expect(pairs).not.toContain(pairKey('p3', 'p4'))
  })
})

describe('pairPlayers (odd field)', () => {
  it('sits out the lowest in the table who has not paused', () => {
    const result = pairPlayers(field([2, 2, 1, 1, 0]), { pause: true })

    expect(result.pause).toBe('p5')
    expect(result.pairs).toHaveLength(2)
    expect(result.unpaired).toEqual([])
  })

  it('does not let a player pause twice while another has not paused', () => {
    const players = field([2, 2, 1, 1, 0], i => ({ pauses: i === 4 ? 1 : 0 }))
    const result = pairPlayers(players, { pause: true })

    expect(result.pause).toBe('p4')
  })

  it('takes the next lowest when the lowest cannot sit out without a rematch', () => {
    // Without p5, p1..p4 cannot be paired: p1 has met p2 and p3 and p4... leave p5 in, p4 out instead.
    const players = [
      player('p1', 2, 1, { opponents: new Set(['p2', 'p3']) }),
      player('p2', 2, 2, { opponents: new Set(['p1']) }),
      player('p3', 1, 3, { opponents: new Set(['p1']) }),
      player('p4', 1, 4, {}),
      player('p5', 0, 5, { opponents: new Set(['p4']) }),
    ]
    const result = pairPlayers(players, { pause: true })

    expect(result.unpaired).toEqual([])
    expect(result.pairs.every(pair => !pair.rematch)).toBe(true)
    expect(result.pause).not.toBeNull()
    const all = [...result.pairs.flatMap(pair => [pair.a, pair.b]), result.pause!]
    expect(new Set(all).size).toBe(5)
  })

  it('leaves the odd one unpaired without the pause option', () => {
    const result = pairPlayers(field([2, 1, 0]))

    expect(result.pause).toBeNull()
    expect(result.pairs).toHaveLength(1)
    expect(result.unpaired).toHaveLength(1)
  })
})

describe('pairPlayers (rematches)', () => {
  const allMet = (ids: string[]) => ids.map((id, i) => player(id, 0, i + 1, { opponents: new Set(ids.filter(other => other !== id)) }))

  it('leaves players unpaired who have met everybody left', () => {
    const result = pairPlayers(allMet(['a', 'b']))

    expect(result.pairs).toEqual([])
    expect(result.unpaired.sort()).toEqual(['a', 'b'])
  })

  it('pairs them as a flagged rematch when asked to', () => {
    const result = pairPlayers(allMet(['a', 'b', 'c', 'd']), { allowRematch: true })

    expect(result.pairs).toHaveLength(2)
    expect(result.pairs.every(pair => pair.rematch)).toBe(true)
  })

  it('prefers a new pair to a rematch', () => {
    const players = [
      player('a', 1, 1, { opponents: new Set(['b']) }),
      player('b', 1, 2, { opponents: new Set(['a']) }),
      player('c', 1, 3, {}),
      player('d', 1, 4, {}),
    ]
    const result = pairPlayers(players, { allowRematch: true })

    expect(result.pairs.every(pair => !pair.rematch)).toBe(true)
  })
})

describe('pairPlayers (a whole Swiss tournament)', () => {
  /** Plays rounds of a Swiss tournament with random winners and returns what was paired. */
  function play(playersCount: number, rounds: number, seed: number) {
    const random = seededRandom(seed)
    const ids = Array.from({ length: playersCount }, (_, i) => `p${i + 1}`)
    const wins = new Map(ids.map(id => [id, 0]))
    const met = new Map(ids.map(id => [id, new Set<string>()]))
    const pauses = new Map(ids.map(id => [id, 0]))
    const log: Array<{ pairs: number, unpaired: number, rematches: number, pause: string | null }> = []
    for (let round = 1; round <= rounds; round += 1) {
      const ranked = [...ids].sort((a, b) => wins.get(b)! - wins.get(a)! || a.localeCompare(b))
      const players = ranked.map((id, i) => player(id, wins.get(id)! + pauses.get(id)! * 0.5, i + 1, { opponents: met.get(id)!, pauses: pauses.get(id)! }))
      const result = pairPlayers(players, { pause: true })
      log.push({ pairs: result.pairs.length, unpaired: result.unpaired.length, rematches: result.pairs.filter(pair => pair.rematch).length, pause: result.pause })
      for (const pair of result.pairs) {
        const winner = random() < 0.5 ? pair.a : pair.b
        wins.set(winner, wins.get(winner)! + 1)
        met.get(pair.a)!.add(pair.b)
        met.get(pair.b)!.add(pair.a)
      }
      if (result.pause) {
        pauses.set(result.pause, pauses.get(result.pause)! + 1)
      }
    }
    return log
  }

  it('pairs 22 players for 6 rounds without a rematch and with everybody paired', () => {
    const log = play(22, 6, 1)

    expect(log.every(round => round.pairs === 11 && round.unpaired === 0 && round.rematches === 0)).toBe(true)
  })

  it('gives an odd field a pause in every round, to a different player each time', () => {
    const log = play(21, 6, 2)
    const paused = log.map(round => round.pause)

    expect(paused.every(pause => pause !== null)).toBe(true)
    expect(new Set(paused).size).toBe(6)
    expect(log.every(round => round.pairs === 10 && round.unpaired === 0 && round.rematches === 0)).toBe(true)
  })
})
