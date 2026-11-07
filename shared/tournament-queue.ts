// Who plays when (ADR 0042). There are no rigid rounds: as soon as a table is free, the next duel that can be
// played starts, so no table stands empty while everybody waits for the last duel of a round. A duel can be played
// when it is fixed and both of its players are in no running duel. The duel goes first whose players have the most
// duels still open (so everybody finishes at about the same time and nobody is through after three hours); at a
// tie the one who has waited longest. The days ("Spieltag") are a display and block nothing, unless the tournament is
// played in Spieltage (`byRound`).

import { isLive, openDuelsOf } from './tournament-duels'
import type { Duel, DuelsState } from './tournament-duels'
import { maxWeightMatching } from './tournament-matching'
import type { MatchingEdge } from './tournament-matching'

export interface QueueOrder {
  /** Duels that can start now, one per free table, in the order they were picked. */
  start: Array<{ duelId: string, table: number }>
  /** Every fixed duel that is waiting, best first: the queue as it is shown. */
  waiting: Duel[]
  /** Tables that have no duel and, with the players who are free, could have one. */
  usableFreeTables: number
}

/** Milliseconds since this player's last duel ended, or since the start: what "waited longest" means. */
function waitingSince(state: DuelsState, playerId: string, startedAt: number): number {
  let last = startedAt
  for (const duel of state.duels) {
    if ((duel.a === playerId || duel.b === playerId) && duel.endedAt !== null) {
      last = Math.max(last, duel.endedAt)
    }
  }
  return last
}

/**
 * The queue. `tables` is how many tables there are; `startedAt` the start of the tournament (the time everybody has
 * been waiting since at first). Only duels between two active players are in it: a duel of a player who left is struck
 * or waits for the organizer's decision.
 *
 * `byRound` turns the days into a gate (a tournament played in Spieltage): a duel only starts when every duel of an
 * earlier day is over, so a whole day is played side by side and the next one waits for its last duel.
 */
export function planQueue(state: DuelsState, tables: number, startedAt: number, byRound = false): QueueOrder {
  const running = state.duels.filter(duel => duel.status === 'running')
  const busy = new Set(running.flatMap(duel => [duel.a, duel.b]))
  const usedTables = new Set(running.map(duel => duel.table).filter((table): table is number => table !== null))
  const freePlayers = state.players.filter(player => player.status === 'active' && !busy.has(player.id))
  const usableFreeTables = Math.max(0, Math.min(tables - running.length, Math.floor(freePlayers.length / 2)))

  const since = new Map(state.players.map(player => [player.id, waitingSince(state, player.id, startedAt)]))
  const open = new Map(state.players.map(player => [player.id, openDuelsOf(state, player.id).length]))
  const better = (x: Duel, y: Duel): number =>
    (open.get(y.a)! + open.get(y.b)!) - (open.get(x.a)! + open.get(x.b)!)
    || Math.min(since.get(x.a)!, since.get(x.b)!) - Math.min(since.get(y.a)!, since.get(y.b)!)
    || x.round - y.round
    || x.id.localeCompare(y.id)

  const waiting = state.duels.filter(duel => duel.status === 'planned' && isLive(state, duel)).sort(better)

  // The duels that start now: the best first, but only a duel that still lets the free tables all be filled (no table
  // stands empty because the best duel blocked two others), which is asked of a matching among the free players.
  const currentRound = Math.min(...state.duels
    .filter(duel => (duel.status === 'planned' || duel.status === 'running') && isLive(state, duel))
    .map(duel => duel.round))
  const playable = waiting.filter(duel => !busy.has(duel.a) && !busy.has(duel.b) && (!byRound || duel.round === currentRound))
  // No more duels than can be played side by side: free players alone do not make a duel (they may have none left to play).
  const startable = Math.min(usableFreeTables, largestMatching(playable))
  const chosen: Duel[] = []
  const taken = new Set<string>()
  for (const duel of playable) {
    if (chosen.length >= startable) {
      break
    }
    if (taken.has(duel.a) || taken.has(duel.b)) {
      continue
    }
    const stillNeeded = startable - chosen.length - 1
    const remaining = playable.filter(other => other.id !== duel.id && ![duel.a, duel.b, ...taken].some(id => other.a === id || other.b === id))
    if (stillNeeded === 0 || largestMatching(remaining) >= stillNeeded) {
      chosen.push(duel)
      taken.add(duel.a)
      taken.add(duel.b)
    }
  }

  const start: Array<{ duelId: string, table: number }> = []
  let tableNumber = 1
  for (const duel of chosen) {
    while (usedTables.has(tableNumber)) {
      tableNumber += 1
    }
    start.push({ duelId: duel.id, table: tableNumber })
    usedTables.add(tableNumber)
  }
  return { start, waiting, usableFreeTables }
}

/** The most duels among these that can be played side by side (no player twice). */
function largestMatching(duels: readonly Duel[]): number {
  const index = new Map<string, number>()
  for (const duel of duels) {
    for (const id of [duel.a, duel.b]) {
      if (!index.has(id)) {
        index.set(id, index.size)
      }
    }
  }
  const edges: MatchingEdge[] = duels.map(duel => [index.get(duel.a)!, index.get(duel.b)!, 1])
  return maxWeightMatching(edges, true).filter(mate => mate >= 0).length / 2
}

/**
 * Every waiting player's place in the queue: the number of the first waiting duel they are in (1 = next up). Players in a
 * running duel or with no duel to wait for are not in the map.
 */
export function queuePositions(state: DuelsState, order: QueueOrder): Map<string, number> {
  const busy = new Set(state.duels.filter(duel => duel.status === 'running').flatMap(duel => [duel.a, duel.b]))
  const positions = new Map<string, number>()
  order.waiting.forEach((duel, index) => {
    for (const playerId of [duel.a, duel.b]) {
      if (!busy.has(playerId) && !positions.has(playerId)) {
        positions.set(playerId, index + 1)
      }
    }
  })
  return positions
}
