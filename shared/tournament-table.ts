// The table of a queue tournament (ADR 0042), worked out from the duels every time it is shown. Sorted by
// wins; because everybody ends with the same number of duels there is no win rate. Ties are broken by the
// Buchholz sum (the wins of all one's opponents, which evens out the luck of the draw) and then, for exactly two
// players who played each other, by that duel (with a rematch both count, 1:1 goes on). What is left is a tie:
// both get the same place, and for first place the app asks for a deciding duel.

import { opponentIn } from './tournament-duels'
import type { Duel, DuelsState } from './tournament-duels'

export interface TableRow {
  playerId: string
  /** 1-based place, equal for a tie; `null` for a player who left (grey, no place). */
  place: number | null
  wins: number
  /** Duels played: the table can show unequal numbers during the tournament (pauses, make-up duels to come). */
  played: number
  buchholz: number
  /** Left the tournament: listed grey, without a place. */
  left: boolean
  /** The player is level with another one after every tiebreak (the place is shared). */
  tied: boolean
}

type Counted = Omit<TableRow, 'place' | 'tied'>

/** How the two players stand against each other: their wins in the done duels between them. */
function headToHead(duels: readonly Duel[], x: string, y: string): { x: number, y: number } {
  const result = { x: 0, y: 0 }
  const decider = { x: 0, y: 0 }
  for (const duel of duels) {
    if (duel.status !== 'done' || !duel.winner) {
      continue
    }
    if ((duel.a === x && duel.b === y) || (duel.a === y && duel.b === x)) {
      const score = duel.kind === 'decider' ? decider : result
      if (duel.winner === x) {
        score.x += 1
      }
      else if (duel.winner === y) {
        score.y += 1
      }
    }
  }
  // The deciding duel settles the tie whatever the earlier duels said.
  return decider.x !== decider.y ? decider : result
}

/**
 * The table. Disqualified players are not in it at all; players who left are at the bottom, grey, without a
 * place, with the record they had. Duels that were struck count for nobody.
 */
export function computeTable(state: DuelsState): TableRow[] {
  const counted = state.duels.filter(duel => duel.status === 'done' && duel.winner)
  const wins = new Map<string, number>()
  for (const duel of counted) {
    wins.set(duel.winner!, (wins.get(duel.winner!) ?? 0) + 1)
  }
  const shown = state.players.filter(player => player.status !== 'disqualified')
  const seedOf = new Map(state.players.map(player => [player.id, player.seed]))

  const rowOf = (playerId: string): Counted => {
    const own = counted.filter(duel => opponentIn(duel, playerId) !== null)
    const buchholz = own.reduce((sum, duel) => sum + (wins.get(opponentIn(duel, playerId)!) ?? 0), 0)
    return { playerId, wins: wins.get(playerId) ?? 0, played: own.length, buchholz, left: false }
  }

  const playing = shown.filter(player => player.status === 'active').map(player => rowOf(player.id))
  playing.sort((x, y) => y.wins - x.wins || y.buchholz - x.buchholz || seedOf.get(x.playerId)! - seedOf.get(y.playerId)!)

  // Groups level on wins and Buchholz: two players are told apart by their duel, more than two stay level.
  const rows: TableRow[] = []
  let start = 0
  while (start < playing.length) {
    let end = start + 1
    while (end < playing.length && playing[end]!.wins === playing[start]!.wins && playing[end]!.buchholz === playing[start]!.buchholz) {
      end += 1
    }
    const group = playing.slice(start, end)
    if (group.length === 2) {
      const result = headToHead(counted, group[0]!.playerId, group[1]!.playerId)
      if (result.x !== result.y) {
        const ordered = result.y > result.x ? [group[1]!, group[0]!] : group
        rows.push({ ...ordered[0]!, place: start + 1, tied: false }, { ...ordered[1]!, place: start + 2, tied: false })
        start = end
        continue
      }
    }
    for (const row of group) {
      rows.push({ ...row, place: start + 1, tied: group.length > 1 })
    }
    start = end
  }

  // A player who left still sees what they played, struck duels included (they count for nobody else).
  const leftRows = shown
    .filter(player => player.status === 'dropped')
    .sort((x, y) => x.seed - y.seed)
    .map((player): TableRow => {
      const own = state.duels.filter(duel => (duel.status === 'done' || duel.status === 'void') && duel.winner !== null && opponentIn(duel, player.id) !== null)
      return { playerId: player.id, place: null, wins: own.filter(duel => duel.winner === player.id).length, played: own.length, buchholz: 0, left: true, tied: false }
    })
  return [...rows, ...leftRows]
}
