// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { maxWeightMatching } from '../../shared/tournament-matching'
import type { MatchingEdge } from '../../shared/tournament-matching'
import { seededRandom } from '../../shared/tournament-draw'

/** The best matching by trying them all: [edges, weight] with the most edges first when `maxCardinality`. */
function bruteForce(edges: readonly MatchingEdge[], maxCardinality: boolean): { count: number, weight: number } {
  let best = { count: 0, weight: 0 }
  const used = new Set<number>()
  const visit = (from: number, count: number, weight: number) => {
    const better = maxCardinality
      ? count > best.count || (count === best.count && weight > best.weight)
      : weight > best.weight
    if (better) {
      best = { count, weight }
    }
    for (let k = from; k < edges.length; k += 1) {
      const [i, j, w] = edges[k]!
      if (!used.has(i) && !used.has(j)) {
        used.add(i)
        used.add(j)
        visit(k + 1, count + 1, weight + w)
        used.delete(i)
        used.delete(j)
      }
    }
  }
  visit(0, 0, 0)
  return best
}

function resultOf(edges: readonly MatchingEdge[], mate: number[]): { count: number, weight: number } {
  let count = 0
  let weight = 0
  for (const [i, j, w] of edges) {
    if (mate[i] === j && mate[j] === i) {
      count += 1
      weight += w
    }
  }
  return { count, weight }
}

function randomGraph(random: () => number, vertices: number, density: number, maxWeight: number): MatchingEdge[] {
  const edges: MatchingEdge[] = []
  for (let i = 0; i < vertices; i += 1) {
    for (let j = i + 1; j < vertices; j += 1) {
      if (random() < density) {
        edges.push([i, j, 1 + Math.floor(random() * maxWeight)])
      }
    }
  }
  return edges
}

describe('maxWeightMatching', () => {
  it('has no matching for no edges', () => {
    expect(maxWeightMatching([])).toEqual([])
  })

  it('takes the heavier of two edges that share a vertex', () => {
    expect(maxWeightMatching([[0, 1, 5], [1, 2, 7]])).toEqual([-1, 2, 1])
  })

  it('prefers two light edges to one heavy one only when they weigh more, or when the most edges are asked for', () => {
    const edges: MatchingEdge[] = [[0, 1, 5], [1, 2, 11], [2, 3, 5]]

    expect(maxWeightMatching(edges, false)).toEqual([-1, 2, 1, -1])
    expect(maxWeightMatching(edges, true)).toEqual([1, 0, 3, 2])
  })

  it('matches an odd cycle with a blossom', () => {
    // A triangle with a tail: the blossom has to be found for the 4 vertices to be matched twice.
    const edges: MatchingEdge[] = [[0, 1, 8], [1, 2, 9], [0, 2, 10], [2, 3, 7]]
    const mate = maxWeightMatching(edges)

    expect(resultOf(edges, mate)).toEqual(bruteForce(edges, false))
  })

  it('is as good as trying every matching, with and without the most edges first', () => {
    const random = seededRandom(20261031)
    for (let trial = 0; trial < 400; trial += 1) {
      const vertices = 2 + Math.floor(random() * 8)
      const edges = randomGraph(random, vertices, 0.25 + random() * 0.6, 1 + Math.floor(random() * 12))
      if (edges.length === 0) {
        continue
      }
      for (const maxCardinality of [false, true]) {
        const mate = maxWeightMatching(edges, maxCardinality)
        const got = resultOf(edges, mate)
        const want = bruteForce(edges, maxCardinality)

        expect(got.weight, `trial ${trial} cardinality ${maxCardinality}: ${JSON.stringify(edges)}`).toBe(want.weight)
        if (maxCardinality) {
          expect(got.count, `trial ${trial}`).toBe(want.count)
        }
        // A matching: every vertex is matched with at most one other, both ways.
        mate.forEach((other, v) => {
          if (other >= 0) {
            expect(mate[other]).toBe(v)
          }
        })
      }
    }
  })

  it('pairs 40 players completely, with the weight preferring close results', () => {
    const random = seededRandom(5)
    const wins = Array.from({ length: 40 }, () => Math.floor(random() * 6))
    const edges: MatchingEdge[] = []
    for (let i = 0; i < 40; i += 1) {
      for (let j = i + 1; j < 40; j += 1) {
        edges.push([i, j, 1000 - 100 * Math.abs(wins[i]! - wins[j]!)])
      }
    }
    const mate = maxWeightMatching(edges, true)

    expect(mate.every(other => other >= 0)).toBe(true)
    // Nobody is paired with somebody more than one win away if every one can be paired with a close one.
    const far = mate.filter((other, v) => Math.abs(wins[v]! - wins[other]!) > 1).length
    expect(far).toBeLessThanOrEqual(4)
  })
})
