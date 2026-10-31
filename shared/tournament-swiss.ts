// Pairing for the Swiss system and for the pool of make-up duels (ADR 0042). Every pairing is a maximum weight
// matching: the weight is high when two players have a similar record, a pair that already met has no edge, and
// the most pairs always come first, so a late round does not end in a dead end the way pairing from the top of the
// table down does.

import { maxWeightMatching } from './tournament-matching'
import type { MatchingEdge } from './tournament-matching'

/** The key of an unordered pair of players. */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

export interface PairablePlayer {
  id: string
  /** Wins; for the pairing only, a missing duel (a pause) counts as half a win so the player does not sink to the bottom. */
  score: number
  /** Everyone this player has met or has a fixed duel with. */
  opponents: ReadonlySet<string>
  /** How often the player has paused. Nobody pauses twice while another player has not paused. */
  pauses: number
  /** 1 is the top of the table. */
  rank: number
}

export interface PairedDuel {
  a: string
  b: string
  /** The two have met before: only paired when there was no other way, and for the organizer to confirm. */
  rematch: boolean
}

export interface PairingResult {
  pairs: PairedDuel[]
  /** The player who sits out (an odd number of players with `pause` on). */
  pause: string | null
  /** Players left without a partner: nobody they have not met was left. */
  unpaired: string[]
}

export interface PairingOptions {
  /** Pairs that must not be made, whatever the players' history: duels that are already fixed. */
  forbidden?: ReadonlySet<string>
  /** Pair players that have met when nothing else is left (flagged `rematch`), instead of leaving them unpaired. */
  allowRematch?: boolean
  /** An odd number of players: one sits out (the lowest in the table of those who have not paused). Else the odd one stays unpaired. */
  pause?: boolean
}

/** A weight that is large next to what the differences of records take off, so only the differences matter among full matchings. */
const BASE_WEIGHT = 1_000_000
const RECORD_STEP = 10_000
const RANK_STEP = 10
/** A rematch is taken only when it makes the matching larger or the only one possible. */
const REMATCH_PENALTY = 400_000

function matchPlayers(list: readonly PairablePlayer[], options: PairingOptions): { pairs: PairedDuel[], unpaired: string[] } {
  const edges: MatchingEdge[] = []
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      const a = list[i]!
      const b = list[j]!
      if (options.forbidden?.has(pairKey(a.id, b.id))) {
        continue
      }
      const met = a.opponents.has(b.id) || b.opponents.has(a.id)
      if (met && !options.allowRematch) {
        continue
      }
      const weight = BASE_WEIGHT
        - RECORD_STEP * Math.round(Math.abs(a.score - b.score) * 2)
        - RANK_STEP * Math.abs(a.rank - b.rank)
        - (met ? REMATCH_PENALTY : 0)
      edges.push([i, j, weight])
    }
  }
  const mate = maxWeightMatching(edges, true)
  const pairs: PairedDuel[] = []
  const unpaired: string[] = []
  list.forEach((player, i) => {
    const other = mate[i] ?? -1
    if (other < 0) {
      unpaired.push(player.id)
    }
    else if (i < other) {
      const partner = list[other]!
      pairs.push({ a: player.id, b: partner.id, rematch: player.opponents.has(partner.id) || partner.opponents.has(player.id) })
    }
  })
  return { pairs, unpaired }
}

/**
 * Pairs the players. With an odd number and `pause`, the one who sits out is the lowest in the table among those who
 * have paused least, as long as the rest can then all be paired without a rematch; else the first that leaves the
 * fewest unpaired.
 */
export function pairPlayers(players: readonly PairablePlayer[], options: PairingOptions = {}): PairingResult {
  if (players.length < 2) {
    return { pairs: [], pause: null, unpaired: players.map(player => player.id) }
  }
  const sorted = [...players].sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id))
  if (sorted.length % 2 === 0 || !options.pause) {
    const { pairs, unpaired } = matchPlayers(sorted, options)
    return { pairs, pause: null, unpaired }
  }

  const fewest = Math.min(...sorted.map(player => player.pauses))
  const candidates = [...sorted].sort((a, b) => a.pauses - b.pauses || b.rank - a.rank)
  let best: { result: { pairs: PairedDuel[], unpaired: string[] }, pause: PairablePlayer } | null = null
  for (const candidate of candidates) {
    const result = matchPlayers(sorted.filter(player => player.id !== candidate.id), options)
    if (result.unpaired.length === 0 && result.pairs.every(pair => !pair.rematch)) {
      best = { result, pause: candidate }
      break
    }
    if (!best || result.unpaired.length < best.result.unpaired.length || (result.unpaired.length === best.result.unpaired.length && result.pairs.filter(p => p.rematch).length < best.result.pairs.filter(p => p.rematch).length && candidate.pauses === fewest)) {
      best = { result, pause: candidate }
    }
  }
  return { pairs: best!.result.pairs, pause: best!.pause.id, unpaired: best!.result.unpaired }
}
