// The state of a queue tournament (ADR 0042), as plain data: who plays, which duels exist and how each stands.
// The table, the queue and the make-up pool are calculated from this, never stored.

export type DuelPlayerStatus = 'active' | 'dropped' | 'disqualified'

/** What a player who leaves wants done with the duels played against them (spec: option A or B). */
export type DropOption = 'A' | 'B'

export interface DuelPlayer {
  id: string
  /** Registration order; the last tiebreak of a table. */
  seed: number
  status: DuelPlayerStatus
  /** Set when the player left: A = out of the standing entirely, B = played duels stay. `null` while it is still open or the player is active. */
  dropOption: DropOption | null
}

/** A planned duel of the draw, a duel that fills in for a missing one (`makeup`), or a second one between two who met (`rematch`). */
export type DuelKind = 'regular' | 'makeup' | 'rematch'
export type DuelStatus = 'planned' | 'running' | 'done' | 'void'

export interface Duel {
  id: string
  a: string
  b: string
  /** The round (Swiss) or Spieltag (the others) the duel is shown under, from 1; make-up duels carry the number of the round they make up for. */
  round: number
  kind: DuelKind
  status: DuelStatus
  /** Only for a done duel. */
  winner: string | null
  /** The table of a running or a done duel. */
  table: number | null
  /** Milliseconds since the epoch. */
  startedAt: number | null
  endedAt: number | null
}

/** A player who sat out a round (an odd number of players in the Swiss system). A pause is no win and the duel is made up. */
export interface Pause {
  round: number
  playerId: string
}

export interface DuelsState {
  players: DuelPlayer[]
  duels: Duel[]
  /** Pauses so far; missing means none. */
  pauses?: Pause[]
}

/** The highest round that has been paired so far (0 before the start); make-up duels belong to rounds already counted. */
export function pairedRounds(state: DuelsState): number {
  return Math.max(0, ...state.duels.filter(duel => duel.kind !== 'makeup').map(duel => duel.round), ...(state.pauses ?? []).map(pause => pause.round))
}

/** The duels that count for the table: done and not struck. */
export function playedDuels(state: DuelsState): Duel[] {
  return state.duels.filter(duel => duel.status === 'done')
}

/** The opponent of `playerId` in `duel`, or null if the player is not in it. */
export function opponentIn(duel: Duel, playerId: string): string | null {
  if (duel.a === playerId) {
    return duel.b
  }
  return duel.b === playerId ? duel.a : null
}

/** Duels of a player that still have to be played (planned or running). */
export function openDuelsOf(state: DuelsState, playerId: string): Duel[] {
  return state.duels.filter(duel => (duel.status === 'planned' || duel.status === 'running') && opponentIn(duel, playerId) !== null)
}

/** Players who are still in the tournament (not left, not disqualified). */
export function activePlayers(state: DuelsState): DuelPlayer[] {
  return state.players.filter(player => player.status === 'active')
}

/** The two players of a duel are both still playing. */
export function isLive(state: DuelsState, duel: Duel): boolean {
  const active = new Set(activePlayers(state).map(player => player.id))
  return active.has(duel.a) && active.has(duel.b)
}
