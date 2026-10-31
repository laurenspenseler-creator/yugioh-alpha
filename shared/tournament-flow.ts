// How a queue tournament is built up (ADR 0042): which duels are fixed at the start, and, for the Swiss system, which round
// is paired when. Pure: the server passes the state in and writes the new duels out.

import { opponentIn } from './tournament-duels'
import type { DuelKind, DuelsState, Pause } from './tournament-duels'
import { championsLeagueDraw, matchdaysOf, roundRobinDuels, shuffled } from './tournament-draw'
import type { QueueMode } from './tournament-modes'
import { pairKey, pairPlayers } from './tournament-swiss'
import type { PairablePlayer } from './tournament-swiss'
import { computeTable } from './tournament-table'

export interface FlowSetup {
  mode: QueueMode
  /** R; null for a round robin. */
  rounds: number | null
  /** Swiss only: rounds 1 and 2 are paired before the start and round k + 2 as soon as round k is complete. */
  prelaunch: boolean
}

export interface NewDuel {
  a: string
  b: string
  round: number
  kind: DuelKind
}

export interface PairedRound {
  round: number
  duels: NewDuel[]
  pause: Pause | null
  /** The duel that makes up the two pauses of this and the last round, once both are known. */
  makeup: NewDuel | null
}

/** Duels that make up for a pause: between the player who sat out this round and the one who sat out the round before. */
function makeupBetween(state: DuelsState, previous: Pause | undefined, current: Pause | null, round: number): NewDuel | null {
  if (!previous || !current || previous.playerId === current.playerId) {
    return null
  }
  const met = state.duels.some(duel => duel.status !== 'void' && opponentIn(duel, previous.playerId) === current.playerId)
  return { a: previous.playerId, b: current.playerId, round, kind: met ? 'rematch' : 'makeup' }
}

/**
 * The pairing players get from the state: what every player has so far (wins, a pause as half a win), whom they have
 * met or are to meet, and their place in the table.
 */
function pairablePlayers(state: DuelsState): PairablePlayer[] {
  const table = computeTable(state)
  const pauses = state.pauses ?? []
  const rank = new Map(table.filter(row => !row.left).map((row, i) => [row.playerId, i + 1]))
  return state.players.filter(player => player.status === 'active').map((player) => {
    const row = table.find(r => r.playerId === player.id)!
    const own = pauses.filter(pause => pause.playerId === player.id).length
    const opponents = new Set<string>()
    for (const duel of state.duels) {
      const other = duel.status === 'void' ? null : opponentIn(duel, player.id)
      if (other) {
        opponents.add(other)
      }
    }
    return { id: player.id, score: row.wins + own * 0.5, opponents, pauses: own, rank: rank.get(player.id) ?? 1_000 }
  })
}

/** Round 1 of the Swiss system is drawn: the players are shuffled and paired in turn, the odd one sits out. */
function drawFirstRound(ids: readonly string[], random: () => number): PairedRound {
  const order = shuffled(ids, random)
  const duels: NewDuel[] = []
  for (let i = 0; i + 1 < order.length; i += 2) {
    duels.push({ a: order[i]!, b: order[i + 1]!, round: 1, kind: 'regular' })
  }
  const pause = order.length % 2 === 1 ? { round: 1, playerId: order.at(-1)! } : null
  return { round: 1, duels, pause, makeup: null }
}

/**
 * Pairs round `round` of the Swiss system from the state, as a maximum matching: similar record, nobody twice, and the
 * pause for the lowest in the table who has not paused (and, in an even round, not met the player who paused before).
 */
export function pairSwissRound(state: DuelsState, round: number): PairedRound {
  const players = pairablePlayers(state)
  const pauses = state.pauses ?? []
  const previous = round % 2 === 0 ? pauses.find(pause => pause.round === round - 1) : undefined
  const result = pairPlayers(players, {
    pause: true,
    pauseNot: previous ? new Set(players.find(player => player.id === previous.playerId)?.opponents ?? []) : undefined,
  })
  const pause = result.pause ? { round, playerId: result.pause } : null
  const duels: NewDuel[] = result.pairs.map(pair => ({ a: pair.a, b: pair.b, round, kind: pair.rematch ? 'rematch' as const : 'regular' as const }))
  return { round, duels, pause, makeup: makeupBetween(state, previous, pause, round) }
}

/**
 * The duels that are fixed when the tournament starts. Round robin and Champions League: all of them, with the Spieltag of
 * each. Swiss: round 1, drawn at random, and with a head start round 2 as well (paired without a rematch of round 1, and the
 * two pauses made up when the field is odd).
 */
export function startingSchedule(setup: FlowSetup, playerIds: readonly string[], random: () => number = Math.random): { duels: NewDuel[], pauses: Pause[] } {
  if (setup.mode === 'round_robin') {
    const duels = roundRobinDuels(playerIds)
    const days = matchdaysOf(duels)
    return { duels: duels.map((duel, i) => ({ a: duel.a, b: duel.b, round: days[i]!, kind: 'regular' as const })), pauses: [] }
  }
  if (setup.mode === 'champions_league') {
    const duels = championsLeagueDraw(playerIds, setup.rounds ?? 0, random)
    const days = matchdaysOf(duels)
    return { duels: duels.map((duel, i) => ({ a: duel.a, b: duel.b, round: days[i]!, kind: 'regular' as const })), pauses: [] }
  }

  const first = drawFirstRound(playerIds, random)
  const duels = [...first.duels]
  const pauses: Pause[] = first.pause ? [first.pause] : []
  if (setup.prelaunch && (setup.rounds ?? 0) >= 2) {
    const state: DuelsState = {
      players: playerIds.map((id, i) => ({ id, seed: i + 1, status: 'active' as const, dropOption: null })),
      duels: duels.map((duel, i) => ({ ...duel, id: `start-${i}`, status: 'planned' as const, winner: null, table: null, startedAt: null, endedAt: null })),
      pauses,
    }
    const second = pairSwissRound(state, 2)
    duels.push(...second.duels)
    if (second.pause) {
      pauses.push(second.pause)
    }
    if (second.makeup) {
      duels.push(second.makeup)
    }
  }
  return { duels, pauses }
}

/**
 * The Swiss round that can be paired now, if any. Classic: round k + 1 once every regular duel of round k is done (a
 * make-up duel does not hold the round up, it fills in the gaps). With a head start: round k + 2 once round k is
 * complete, because rounds 1 and 2 are paired at the start. Never above R.
 */
export function swissRoundDue(state: DuelsState, setup: FlowSetup): PairedRound | null {
  if (setup.mode !== 'swiss' || setup.rounds === null) {
    return null
  }
  const paired = Math.max(0, ...state.duels.filter(duel => duel.kind !== 'makeup').map(duel => duel.round), ...(state.pauses ?? []).map(pause => pause.round))
  const target = paired + 1
  if (target > setup.rounds || paired === 0) {
    return null
  }
  const lead = setup.prelaunch ? 2 : 1
  // Round `target - lead` has to be complete.
  const needed = target - lead
  if (needed >= 1) {
    const open = state.duels.some(duel => duel.kind === 'regular' && duel.round <= needed && (duel.status === 'planned' || duel.status === 'running'))
    if (open) {
      return null
    }
  }
  return pairSwissRound(state, target)
}

/** Pairs that are already fixed, by key: what a later pairing must not repeat. */
export function fixedPairs(state: DuelsState): Set<string> {
  return new Set(state.duels.filter(duel => duel.status !== 'void').map(duel => pairKey(duel.a, duel.b)))
}
