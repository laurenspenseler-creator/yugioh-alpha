// A player leaves, or is thrown out (ADR 0042). Every player who stays must end with the same number of duels, so the
// duels that fall away are made up in a pool among the players who now lack one. Whether that works out is plain
// arithmetic, and it decides which of the two options the organizer is offered.
//
//   A  Out as if never there: every duel of the player is struck, the played ones too. Everyone who played or would
//      have played them lacks a duel.
//   B  The played duels stay; only the open ones are struck. Only the opponents with an open duel lack one.
//
// A disqualified player is always treated as A. A player who left and has not been decided yet keeps all duels, which
// wait (the queue skips them) until the organizer decides.

import type { DropOption, Duel, DuelPlayer, DuelsState } from './tournament-duels'
import { isLive, opponentIn, pairedRounds } from './tournament-duels'
import { pairablePlayers } from './tournament-flow'
import type { FlowSetup, NewDuel } from './tournament-flow'
import { pairPlayers } from './tournament-swiss'
import type { PairedDuel } from './tournament-swiss'

export type LeaveKind = 'dropped' | 'disqualified'

/** A player who is out of the standing completely: their duels count for nobody. */
function isStruckOut(player: DuelPlayer): boolean {
  return player.status === 'disqualified' || (player.status === 'dropped' && player.dropOption === 'A')
}

/** How many duels every player who stays ends up with (Swiss: so far, the number of rounds paired). */
export function targetDuels(state: DuelsState, setup: FlowSetup): number {
  if (setup.mode === 'round_robin') {
    return Math.max(0, state.players.length - 1 - state.players.filter(isStruckOut).length)
  }
  if (setup.mode === 'champions_league') {
    return setup.rounds ?? 0
  }
  return pairedRounds(state)
}

function countOf(state: DuelsState, playerId: string): number {
  return state.duels.filter(duel => duel.status !== 'void' && opponentIn(duel, playerId) !== null).length
}

/** How many duels each active player lacks, by player; players who lack none are not in the map. */
export function deficits(state: DuelsState, setup: FlowSetup): Map<string, number> {
  const target = targetDuels(state, setup)
  const lacking = new Map<string, number>()
  for (const player of state.players) {
    const missing = player.status === 'active' ? target - countOf(state, player.id) : 0
    if (missing > 0) {
      lacking.set(player.id, missing)
    }
  }
  return lacking
}

/** Strikes the duels of a player for option A (all) or B (the open ones). The struck duels keep their winner, for the grey row. */
function strike(state: DuelsState, playerId: string, option: DropOption): DuelsState {
  return {
    ...state,
    duels: state.duels.map((duel): Duel => {
      if (opponentIn(duel, playerId) === null || duel.status === 'void') {
        return duel
      }
      const open = duel.status === 'planned' || duel.status === 'running'
      return option === 'A' || open ? { ...duel, status: 'void', table: null } : duel
    }),
  }
}

/**
 * The player leaves (or is disqualified). With `option` null a player who left stays undecided: nothing is struck yet.
 * Only between duels: a player in a running duel cannot leave.
 */
export function leaveTournament(state: DuelsState, playerId: string, kind: LeaveKind, option: DropOption | null): DuelsState {
  if (state.duels.some(duel => duel.status === 'running' && opponentIn(duel, playerId) !== null)) {
    throw new Error('A player cannot leave in the middle of a duel')
  }
  const chosen = kind === 'disqualified' ? 'A' : option
  const left: DuelsState = {
    ...state,
    players: state.players.map(player => player.id === playerId ? { ...player, status: kind, dropOption: chosen } : player),
  }
  return chosen === null ? left : strike(left, playerId, chosen)
}

/** The organizer decides later for a player who left undecided. */
export function decideLeave(state: DuelsState, playerId: string, option: DropOption): DuelsState {
  const player = state.players.find(candidate => candidate.id === playerId)
  if (!player || player.status !== 'dropped' || player.dropOption !== null) {
    throw new Error('This player has nothing left to decide')
  }
  return strike({ ...state, players: state.players.map(candidate => candidate.id === playerId ? { ...candidate, dropOption: option } : candidate) }, playerId, option)
}

/** The missing duels can be paired among the players who lack them (rematches count): an even sum, nobody lacking more than all others together. */
function poolable(lacking: ReadonlyMap<string, number>): boolean {
  const values = [...lacking.values()]
  const sum = values.reduce((total, value) => total + value, 0)
  return sum % 2 === 0 && (values.length === 0 || Math.max(...values) * 2 <= sum)
}

/** Duels that stay although the opponent left (option B): they count for the opponent who stays, but only once. */
function retainedAgainstLeft(state: DuelsState): number {
  const kept = new Set(state.players.filter(player => player.status === 'dropped' && player.dropOption === 'B').map(player => player.id))
  return state.duels.filter(duel => duel.status !== 'void' && (kept.has(duel.a) !== kept.has(duel.b))).length
}

/**
 * Which options the organizer may choose for this player: only those after which the duels still add up. A is always
 * possible in the Swiss system, because the number of rounds is even and the struck duels are made up in pairs. B is
 * possible there when the duels that stay against players who left are an even number (else one player would be left
 * with a duel nobody can match). The other modes need the pool to pair up. Nothing while the player is in a running duel.
 */
export function dropOptions(state: DuelsState, setup: FlowSetup, playerId: string): Record<DropOption, boolean> {
  if (state.duels.some(duel => duel.status === 'running' && opponentIn(duel, playerId) !== null)) {
    return { A: false, B: false }
  }
  const allowed = (option: DropOption): boolean => {
    const left = leaveTournament(state, playerId, 'dropped', option)
    return setup.mode === 'swiss' ? retainedAgainstLeft(left) % 2 === 0 : poolable(deficits(left, setup))
  }
  return { A: allowed('A'), B: allowed('B') }
}

/**
 * The make-up duels the pool can play now: players who lack duels are paired by the same matching as in the Swiss system,
 * and a pair that has met is a rematch the organizer has to confirm. Swiss waits until both rounds of a pair are paired
 * (the pause of an odd round is still being made up by the next one).
 */
export function poolDuels(state: DuelsState, setup: FlowSetup): NewDuel[] {
  if (setup.mode === 'swiss' && (pairedRounds(state) === 0 || pairedRounds(state) % 2 === 1)) {
    return []
  }
  const round = Math.max(1, ...state.duels.map(duel => duel.round))
  const added: NewDuel[] = []
  let working = state
  // One pair at a time, so a player who lacks several duels is never left alone with the rest of the pool.
  for (let guard = 0; guard < 200; guard += 1) {
    const lacking = deficits(working, setup)
    if (lacking.size < 2) {
      break
    }
    const pair = nextPoolPair(working, lacking)
    if (!pair) {
      break
    }
    const duel: NewDuel = { a: pair.a, b: pair.b, round, kind: pair.rematch ? 'rematch' : 'makeup' }
    added.push(duel)
    working = { ...working, duels: [...working.duels, { ...duel, id: `pool-${added.length}`, status: 'planned', winner: null, table: null, startedAt: null, endedAt: null }] }
  }
  return added
}

/**
 * The next pair of the pool: the best the Swiss matching proposes, but only one that leaves the rest of the pool pairable
 * (nobody stranded who lacks more duels than all the others together); else the best pair among all, new opponents first.
 */
function nextPoolPair(state: DuelsState, lacking: ReadonlyMap<string, number>): PairedDuel | null {
  const players = pairablePlayers(state).filter(player => lacking.has(player.id))
  const leavesPairable = (pair: PairedDuel): boolean => {
    const rest = new Map(lacking)
    for (const id of [pair.a, pair.b]) {
      const left = (rest.get(id) ?? 0) - 1
      if (left > 0) {
        rest.set(id, left)
      }
      else {
        rest.delete(id)
      }
    }
    return poolable(rest)
  }
  const proposed = pairPlayers(players, { allowRematch: true }).pairs
  const all: PairedDuel[] = []
  for (const [i, x] of players.entries()) {
    for (const y of players.slice(i + 1)) {
      all.push({ a: x.id, b: y.id, rematch: x.opponents.has(y.id) || y.opponents.has(x.id) })
    }
  }
  const rank = new Map(players.map(player => [player.id, player.rank]))
  all.sort((p, q) => Number(p.rematch) - Number(q.rematch)
    || Math.abs(rank.get(p.a)! - rank.get(p.b)!) - Math.abs(rank.get(q.a)! - rank.get(q.b)!)
    || p.a.localeCompare(q.a)
    || p.b.localeCompare(q.b))
  return [...proposed, ...all].find(leavesPairable) ?? proposed[0] ?? all[0] ?? null
}

export interface RecomputedRound {
  round: number
  /** The planned duels that are replaced. */
  removed: Duel[]
  added: NewDuel[]
}

/**
 * "Neu berechnen" for the Swiss system: the pairings that have not started are drawn again from the table as it is now.
 * Played and running duels are never touched. A round whose players cannot all be paired anew keeps what it had.
 */
export function recomputeSwiss(state: DuelsState): RecomputedRound[] {
  const rounds = [...new Set(state.duels.filter(duel => duel.kind === 'regular' && duel.status === 'planned' && isLive(state, duel)).map(duel => duel.round))].sort((x, y) => x - y)
  const changes: RecomputedRound[] = []
  let working = state
  for (const round of rounds) {
    const removed = working.duels.filter(duel => duel.kind === 'regular' && duel.status === 'planned' && duel.round === round && isLive(working, duel))
    const inRound = new Set(removed.flatMap(duel => [duel.a, duel.b]))
    const kept: DuelsState = { ...working, duels: working.duels.filter(duel => !removed.includes(duel)) }
    const result = pairPlayers(pairablePlayers(kept).filter(player => inRound.has(player.id)))
    const same = result.pairs.length === removed.length && result.pairs.every(pair => removed.some(duel => (duel.a === pair.a && duel.b === pair.b) || (duel.a === pair.b && duel.b === pair.a)))
    if (result.unpaired.length > 0 || result.pairs.length !== removed.length || same) {
      continue
    }
    const added: NewDuel[] = result.pairs.map(pair => ({ a: pair.a, b: pair.b, round, kind: 'regular' }))
    changes.push({ round, removed, added })
    working = { ...kept, duels: [...kept.duels, ...added.map((duel, i): Duel => ({ ...duel, id: `new-${round}-${i}`, status: 'planned', winner: null, table: null, startedAt: null, endedAt: null }))] }
  }
  return changes
}
