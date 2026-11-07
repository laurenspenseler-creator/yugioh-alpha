// The tournament modes of the queue engine (ADR 0042): how many duels a player has, what a setup is
// worth in time, and which setups are allowed. Pure and dependency-free: the setup form shows the
// estimates while the organizer types, and the server checks the same rules before it starts.
//
// Words: a duel is a single game (best of one); R is the number of duels each player has; n the number
// of players; T the number of tables; d the length of a duel in minutes.

/** Every player plays every other player once; the schedule is complete before the start. */
export type QueueMode = 'round_robin' | 'champions_league' | 'swiss'

export const QUEUE_MODES = ['round_robin', 'champions_league', 'swiss'] as const

/**
 * How the duels are played out. `queue`: tables and a queue, a table that becomes free gets the next duel at once.
 * `rounds`: Spieltage; everybody plays the day's duels side by side and the next day starts when the last duel of
 * the day is done. The mode (round robin, Champions League, Swiss) is independent of it.
 */
export type QueueFlow = 'queue' | 'rounds'

export const QUEUE_FLOWS = ['queue', 'rounds'] as const
export const DEFAULT_FLOW: QueueFlow = 'queue'

/** How many games a duel is: one game, or the first to win two out of three. */
export type BestOf = 1 | 3

export const BEST_OF_CHOICES = [1, 3] as const
export const DEFAULT_BEST_OF: BestOf = 1
/** Games a player has to win to take a best-of-3 duel. */
export const GAMES_TO_WIN_BEST_OF_3 = 2

/** Minutes of a duel when the organizer says nothing else. */
export const DEFAULT_DUEL_MINUTES = 30
export const MIN_DUEL_MINUTES = 1
export const MAX_DUEL_MINUTES = 240
export const MAX_TABLES = 64
/** Fewer players cannot play a tournament, more cannot be handled by one organizer's table. */
export const MIN_QUEUE_PLAYERS = 2

/** What a setup is checked for: a code the interface turns into a sentence in its language. */
export type SetupIssueCode =
  | 'too_few_players'
  | 'rounds_missing'
  | 'rounds_must_be_even'
  | 'rounds_too_small'
  | 'rounds_too_large'
  | 'tables_invalid'
  | 'duel_minutes_invalid'

export interface SetupIssue {
  code: SetupIssueCode
  /** Numbers the sentence needs (the limit the value broke). */
  params?: Record<string, number>
}

export interface SetupInput {
  mode: QueueMode
  players: number
  /** R. Ignored for a round robin, where it is n − 1. */
  rounds: number | null
  tables: number
  duelMinutes: number
  /** Swiss only: the first two rounds are paired before the start. */
  prelaunch?: boolean
  /** `rounds`: Spieltage, the tables do not limit anything. Missing = `queue`. */
  flow?: QueueFlow
}

/** n · (n − 1) / 2. */
export function roundRobinDuelCount(players: number): number {
  return players < 2 ? 0 : players * (players - 1) / 2
}

/** The duels each player has: all of the others in a round robin, else what the organizer chose. */
export function duelsPerPlayer(input: Pick<SetupInput, 'mode' | 'players' | 'rounds'>): number {
  return input.mode === 'round_robin' ? Math.max(0, input.players - 1) : (input.rounds ?? 0)
}

/** Duels in all: n · R / 2 (the players' duels, each counted once). */
export function totalDuels(input: Pick<SetupInput, 'mode' | 'players' | 'rounds'>): number {
  return input.players * duelsPerPlayer(input) / 2
}

/** The tables that can be used at once: no more than half the players play at the same time. */
export function usableTables(tables: number, players: number): number {
  return Math.max(1, Math.min(tables, Math.floor(players / 2)))
}

/**
 * The Spieltage of a tournament played in rounds: n − 1 for a round robin (n when the field is odd, one player sits
 * out each day), R for the others.
 */
export function matchdayCount(input: Pick<SetupInput, 'mode' | 'players' | 'rounds'>): number {
  if (input.mode === 'round_robin') {
    return input.players < 2 ? 0 : input.players % 2 === 0 ? input.players - 1 : input.players
  }
  return input.rounds ?? 0
}

/**
 * The rules a setup must keep. R has to be even for Champions League and Swiss, so a pause or a player who
 * leaves can always be made up (ADR 0042); Champions League cannot give a player more different opponents
 * than there are others, and Swiss cannot either without a rematch.
 */
export function validateSetup(input: SetupInput): SetupIssue[] {
  const issues: SetupIssue[] = []
  if (!Number.isInteger(input.players) || input.players < MIN_QUEUE_PLAYERS) {
    issues.push({ code: 'too_few_players', params: { min: MIN_QUEUE_PLAYERS } })
  }
  // With Spieltage nobody waits for a table, so the number of tables is not asked.
  if (input.flow !== 'rounds' && (!Number.isInteger(input.tables) || input.tables < 1 || input.tables > MAX_TABLES)) {
    issues.push({ code: 'tables_invalid', params: { max: MAX_TABLES } })
  }
  if (!Number.isInteger(input.duelMinutes) || input.duelMinutes < MIN_DUEL_MINUTES || input.duelMinutes > MAX_DUEL_MINUTES) {
    issues.push({ code: 'duel_minutes_invalid', params: { min: MIN_DUEL_MINUTES, max: MAX_DUEL_MINUTES } })
  }
  if (input.mode !== 'round_robin') {
    if (input.rounds === null || !Number.isInteger(input.rounds)) {
      issues.push({ code: 'rounds_missing' })
    }
    else {
      if (input.rounds % 2 !== 0) {
        issues.push({ code: 'rounds_must_be_even' })
      }
      if (input.rounds < 2) {
        issues.push({ code: 'rounds_too_small', params: { min: 2 } })
      }
      if (input.players >= MIN_QUEUE_PLAYERS && input.rounds > input.players - 1) {
        issues.push({ code: 'rounds_too_large', params: { max: input.players - 1 } })
      }
    }
  }
  return issues
}

/**
 * The time a setup takes, in minutes. With a queue (round robin, Champions League, Swiss with a head start) a
 * table is free again as soon as a duel ends, so it is the work divided by the tables, plus one duel because
 * the longest one decides the end; a classic Swiss waits for the last duel of every round.
 */
export function estimateMinutes(input: SetupInput): number {
  // Spieltage: every day takes one duel, whatever the number of tables.
  if (input.flow === 'rounds') {
    return matchdayCount(input) * input.duelMinutes
  }
  const usable = usableTables(input.tables, input.players)
  const rounds = duelsPerPlayer(input)
  if (input.mode === 'swiss' && !input.prelaunch) {
    return rounds * Math.ceil(Math.floor(input.players / 2) / usable) * input.duelMinutes + input.duelMinutes
  }
  return (input.players * rounds / 2) / usable * input.duelMinutes + input.duelMinutes
}

/**
 * The most duels a player can have if the whole tournament is to take `targetMinutes`: the estimate turned
 * around, rounded down to an even number for Champions League and Swiss (at least 2), and not more than
 * the others a player can meet.
 */
export function roundsForDuration(input: Omit<SetupInput, 'rounds'>, targetMinutes: number): number {
  const usable = usableTables(input.tables, input.players)
  const raw = input.flow === 'rounds'
    ? targetMinutes / input.duelMinutes
    : (2 * (targetMinutes - input.duelMinutes) * usable) / (input.players * input.duelMinutes)
  const even = Math.floor(raw / 2) * 2
  return Math.max(2, Math.min(even, maxEvenRounds(input.players)))
}

/** Swiss rule of thumb: log2 of the players rounded up, one more with a head start, then up to an even number. */
export function swissRounds(players: number, prelaunch: boolean): number {
  const base = Math.ceil(Math.log2(Math.max(2, players))) + (prelaunch ? 1 : 0)
  return Math.max(2, base + (base % 2))
}

/**
 * The most rounds a Swiss tournament of this size can have and still stay even and rematch-free: the highest
 * even number not above n − 1.
 */
export function maxEvenRounds(players: number): number {
  const most = Math.max(0, players - 1)
  return most - (most % 2)
}

/** The most Champions League duels a player has when the organizer does not say. */
export const DEFAULT_CHAMPIONS_LEAGUE_ROUNDS = 6

/**
 * R when the organizer leaves it open: the rule of thumb for Swiss, a short league for the Champions League,
 * never more than the field allows. A round robin has no R of its own.
 */
export function defaultRounds(mode: QueueMode, players: number, prelaunch: boolean): number | null {
  if (mode === 'round_robin') {
    return null
  }
  const most = Math.max(2, maxEvenRounds(players))
  const wanted = mode === 'swiss' ? swissRounds(players, prelaunch) : DEFAULT_CHAMPIONS_LEAGUE_ROUNDS
  return Math.min(wanted, most)
}

/** Which mode the app recommends for a number of players (the thresholds follow the examples of the spec). */
export function recommendedMode(players: number): QueueMode {
  if (players <= 8) {
    return 'round_robin'
  }
  return players <= 24 ? 'champions_league' : 'swiss'
}

/** "7,1 h" style: hours and minutes of a duration in minutes. */
export function splitMinutes(minutes: number): { hours: number, minutes: number } {
  const total = Math.max(0, Math.round(minutes))
  return { hours: Math.floor(total / 60), minutes: total % 60 }
}
