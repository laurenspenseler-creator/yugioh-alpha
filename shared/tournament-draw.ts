// The schedules that are fixed before the start (ADR 0042): who plays whom in a round robin and in a
// Champions League, and on which "Spieltag" a duel is shown. No database, no browser; the random number
// generator is a parameter so a test can draw the same tournament twice.

import { roundRobinSchedule } from './tournament-pairing'

export interface DrawnDuel {
  a: string
  b: string
}

/** Mulberry32: a small generator that is the same on every machine, for tests and for a redraw that has to repeat. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6D2B79F5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** The items in a random order (Fisher–Yates); the input is left alone. */
export function shuffled<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1))
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}

/** Every pair of players once. The order is the circle method's, so the first duels are the first Spieltag. */
export function roundRobinDuels(ids: readonly string[]): DrawnDuel[] {
  return roundRobinSchedule([...ids]).flatMap(day => day.flatMap(([a, b]) => b === null ? [] : [{ a, b }]))
}

/**
 * The Champions League draw (ADR 0042): the players are shuffled and set in a circle, and everyone plays the
 * `rounds / 2` nearest neighbours on both sides, so every player has `rounds` different opponents and no pair
 * meets twice. That holds for every even `rounds` up to n − 1, so the draw always works. No pots, no ratings:
 * the shuffle is the whole draw, and it is never repeated after the start.
 */
export function championsLeagueDraw(ids: readonly string[], rounds: number, random: () => number = Math.random): DrawnDuel[] {
  const n = ids.length
  if (rounds % 2 !== 0 || rounds < 0 || rounds > n - 1) {
    throw new RangeError(`A Champions League of ${n} players cannot have ${rounds} rounds`)
  }
  const circle = shuffled(ids, random)
  const duels: DrawnDuel[] = []
  for (let distance = 1; distance <= rounds / 2; distance += 1) {
    for (let i = 0; i < n; i += 1) {
      duels.push({ a: circle[i]!, b: circle[(i + distance) % n]! })
    }
  }
  return duels
}

/**
 * The Spieltag of every duel: the duels are dealt out so that nobody plays twice on a day, with as few days as a
 * few tries find (the days are only a display, they block nothing). `order` says which duels are placed first;
 * duels that were fixed earlier keep their order within a day.
 */
export function matchdaysOf(duels: readonly DrawnDuel[], random: () => number = seededRandom(1), tries = 24): number[] {
  let best: number[] | null = null
  let bestDays = Infinity
  for (let attempt = 0; attempt < tries; attempt += 1) {
    const order = attempt === 0 ? duels.map((_, i) => i) : shuffled(duels.map((_, i) => i), random)
    const busy: Array<Set<string>> = []
    const day = new Array<number>(duels.length).fill(0)
    for (const index of order) {
      const duel = duels[index]!
      let d = 0
      while (busy[d]?.has(duel.a) || busy[d]?.has(duel.b)) {
        d += 1
      }
      busy[d] ??= new Set()
      busy[d]!.add(duel.a)
      busy[d]!.add(duel.b)
      day[index] = d + 1
    }
    const days = busy.length
    if (days < bestDays) {
      best = day
      bestDays = days
    }
  }
  return best ?? []
}
