// The table of a queue tournament (ADR 0042, 0043, 0044, 0046), worked out from the duels every time it is shown. The
// order is the one the testers asked for, and each step only decides between players the one before left level:
//
//   1. Points (how a duel is worth points is the tournament's scoring; with the classic one they are the match points)
//   2. The difference between the games won and lost (a single game counts as 1:0): a 2:0 is worth more than a 2:1
//   3. The direct comparison: who won the duel(s) against the players level on points and difference
//
// The games won in all do not decide anything: more of them is not better (a 2:1 wins one more game than a 2:0 and
// still is the worse win). What is left is a tie: both get the same place, and for first place the app asks for a
// deciding duel.

import { opponentIn } from './tournament-duels'
import type { Duel, DuelsState } from './tournament-duels'

/**
 * How a duel is worth points (ADR 0031). `games`: a win without losing a game 3, a win that lost one 2, a loss with a
 * game won 1, else 0; `match`: 3 for a win, 0 for a loss. A single game has no score to tell them apart: 3 and 0. The scorings of
 * a Spielabend count every game (duel) won: `duel_3_0` 3 points each, `duel_1_0` 1 point each (round 16).
 */
export type PointScoring = 'games' | 'match' | 'duel_3_0' | 'duel_1_0'

/** The points a player got from one done duel. */
export function duelPoints(duel: Duel, playerId: string, scoring: PointScoring): number {
  if (scoring === 'duel_3_0' || scoring === 'duel_1_0') {
    // Every game won counts: 2:1 is 2 games for the winner, 1 for the other; a single game, entered without a score, is 1:0.
    return duelGames(duel, playerId).won * (scoring === 'duel_3_0' ? 3 : 1)
  }
  const won = duel.winner === playerId
  const own = duel.a === playerId ? duel.gamesA : duel.gamesB
  const other = duel.a === playerId ? duel.gamesB : duel.gamesA
  if (scoring === 'match' || own === undefined || own === null || other === undefined || other === null) {
    return won ? 3 : 0
  }
  return won ? (other === 0 ? 3 : 2) : (own >= 1 ? 1 : 0)
}

/** The games a player won and lost in one done duel; a single game, entered without a score, is 1:0 for the winner. */
export function duelGames(duel: Duel, playerId: string): { won: number, lost: number } {
  const own = duel.a === playerId ? duel.gamesA : duel.gamesB
  const other = duel.a === playerId ? duel.gamesB : duel.gamesA
  if (own === undefined || own === null || other === undefined || other === null) {
    return duel.winner === playerId ? { won: 1, lost: 0 } : { won: 0, lost: 1 }
  }
  return { won: own, lost: other }
}

export interface TableRow {
  playerId: string
  /** 1-based place, equal for a tie; `null` for a player who left (grey, no place). */
  place: number | null
  wins: number
  /** Duels lost (a duel always has a winner, so these are the duels played minus the wins). */
  losses: number
  /** Points by the scoring of the tournament. */
  points: number
  /** Duels played: the table can show unequal numbers during the tournament (pauses, make-up duels to come). */
  played: number
  /** The Spieltage the player has played on (the days with a done duel of theirs; a make-up duel counts for its day). */
  matchdays: number
  /** The games won and lost in all duels (a single game counts as 1:0). */
  gamesWon: number
  gamesLost: number
  /** Left the tournament: listed grey, without a place. */
  left: boolean
  /** The player is level with another one after every tiebreak (the place is shared). */
  tied: boolean
}

type Counted = Omit<TableRow, 'place' | 'tied'>

/**
 * How each player of `group` did in the done duels against the others of the group: the wins of a deciding duel first
 * (it settles a tie whatever the duels before said), then the wins of the other duels.
 */
function directWins(duels: readonly Duel[], group: readonly string[]): Map<string, [number, number]> {
  const inGroup = new Set(group)
  const result = new Map<string, [number, number]>(group.map(id => [id, [0, 0]]))
  for (const duel of duels) {
    if (duel.winner && inGroup.has(duel.a) && inGroup.has(duel.b)) {
      result.get(duel.winner)![duel.kind === 'decider' ? 0 : 1] += 1
    }
  }
  return result
}

/**
 * The table. Disqualified players are not in it at all; players who left are at the bottom, grey, without a
 * place, with the record they had. Duels that were struck count for nobody.
 */
export function computeTable(state: DuelsState, scoring: PointScoring = 'games'): TableRow[] {
  const counted = state.duels.filter(duel => duel.status === 'done' && duel.winner)
  const recordOf = (playerId: string, duels: readonly Duel[]): Counted => {
    const own = duels.filter(duel => opponentIn(duel, playerId) !== null)
    let gamesWon = 0
    let gamesLost = 0
    for (const duel of own) {
      const games = duelGames(duel, playerId)
      gamesWon += games.won
      gamesLost += games.lost
    }
    const wins = own.filter(duel => duel.winner === playerId).length
    return {
      playerId,
      wins,
      losses: own.length - wins,
      points: own.reduce((sum, duel) => sum + duelPoints(duel, playerId, scoring), 0),
      played: own.length,
      matchdays: new Set(own.map(duel => duel.round)).size,
      gamesWon,
      gamesLost,
      left: false,
    }
  }
  const shown = state.players.filter(player => player.status !== 'disqualified')
  const seedOf = new Map(state.players.map(player => [player.id, player.seed]))

  const playing = shown.filter(player => player.status === 'active').map(player => recordOf(player.id, counted))
  playing.sort((x, y) => y.points - x.points || seedOf.get(x.playerId)! - seedOf.get(y.playerId)!)

  const rows: TableRow[] = []
  let start = 0
  while (start < playing.length) {
    // Everybody level on points: the difference of the games first, then, among those still level, the direct comparison.
    let end = start + 1
    while (end < playing.length && playing[end]!.points === playing[start]!.points) {
      end += 1
    }
    const group = playing.slice(start, end)
    const difference = (row: Counted) => row.gamesWon - row.gamesLost
    group.sort((x, y) => difference(y) - difference(x) || seedOf.get(x.playerId)! - seedOf.get(y.playerId)!)

    let from = 0
    while (from < group.length) {
      // Level on points and on the difference.
      let to = from + 1
      while (to < group.length && difference(group[to]!) === difference(group[from]!)) {
        to += 1
      }
      const level = group.slice(from, to)
      const direct = directWins(counted, level.map(row => row.playerId))
      const compareDirect = (x: Counted, y: Counted) => {
        const [xd, xr] = direct.get(x.playerId)!
        const [yd, yr] = direct.get(y.playerId)!
        return (yd - xd) || (yr - xr)
      }
      level.sort((x, y) => compareDirect(x, y) || seedOf.get(x.playerId)! - seedOf.get(y.playerId)!)

      let first = 0
      while (first < level.length) {
        let last = first + 1
        while (last < level.length && compareDirect(level[first]!, level[last]!) === 0) {
          last += 1
        }
        for (const row of level.slice(first, last)) {
          rows.push({ ...row, place: start + from + first + 1, tied: last - first > 1 })
        }
        first = last
      }
      from = to
    }
    start = end
  }

  // A player who left still sees what they played, struck duels included (they count for nobody else).
  const leftRows = shown
    .filter(player => player.status === 'dropped')
    .sort((x, y) => x.seed - y.seed)
    .map((player): TableRow => {
      const own = state.duels.filter(duel => (duel.status === 'done' || duel.status === 'void') && duel.winner !== null)
      return { ...recordOf(player.id, own), place: null, left: true, tied: false }
    })
  return [...rows, ...leftRows]
}
