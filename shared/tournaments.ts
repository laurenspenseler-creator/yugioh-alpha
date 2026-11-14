// Types, value lists, and limits shared by the server (server/utils/tournaments.ts)
// and the tournament UI (app/pages/tournaments/**). Intentionally dependency-free;
// the labels and error messages live in the i18n catalogues (ADR 0014).

import type { ValidationIssue } from './rule-formats'
import type { DropOption, DuelKind, DuelStatus } from './tournament-duels'
import type { BestOf, QueueFlow, QueueMode } from './tournament-modes'
import type { StandingsRow } from './tournament-standings'

// Scoring constants live in tournament-standings.ts (the standings path);
// re-exported here so the pairing/round-creation path (server/utils/tournaments.ts)
// uses the same values instead of a second, independently-maintained copy.
export {
  BYE_GAMES,
  POINTS_DRAW,
  POINTS_LOSS_WITH_GAME,
  POINTS_WIN,
  POINTS_WIN_DROPPED_GAME,
} from './tournament-standings'

// --- Enums ----------------------------------------------------------------

export const TOURNAMENT_STATUSES = ['registration', 'running', 'finished'] as const
export type TournamentStatus = typeof TOURNAMENT_STATUSES[number]

export const PAIRING_SYSTEMS = ['swiss', 'round_robin'] as const
export type PairingSystem = typeof PAIRING_SYSTEMS[number]

/** 'classic' = rounds of matches; 'queue' = the duel queue with tables of ADR 0042. */
export const TOURNAMENT_ENGINES = ['classic', 'queue'] as const
export type TournamentEngine = typeof TOURNAMENT_ENGINES[number]

/**
 * How a match is turned into points (ADR 0031). `games`: 3 for a win without
 * dropping a game, 2 for a win that dropped one, 1 for a loss that won a game,
 * 0 otherwise — so a 2:0 outranks a 2:1. `match`: classic 3 / 0 (1 for a
 * draw); what tournaments created before ADR 0031 keep.
 */
export const SCORING_SYSTEMS = ['games', 'match'] as const
export type ScoringSystem = typeof SCORING_SYSTEMS[number]

/**
 * What a bye is worth. `none`: nothing — no points, no match played, no games.
 * `win`: scored as a 2:0 win (the behavior before ADR 0031).
 */
export const BYE_SCORINGS = ['none', 'win'] as const
export type ByeScoring = typeof BYE_SCORINGS[number]

export const DEFAULT_SCORING: ScoringSystem = 'games'
export const DEFAULT_BYE_SCORING: ByeScoring = 'none'

export const ROUND_STATUSES = ['pending', 'completed'] as const
export type RoundStatus = typeof ROUND_STATUSES[number]

export type TournamentRole = 'organizer' | 'participant'

// --- Constants -------------------------------------------------------------

export const TOURNAMENT_NAME_MAX_LENGTH = 80
export const TOURNAMENT_DESCRIPTION_MAX_LENGTH = 500
export const PARTICIPANT_NAME_MAX_LENGTH = 60
export const MIN_PARTICIPANTS_TO_START = 2
export const MAX_PARTICIPANTS = 64
/**
 * Highest round robin (an even, `MAX_PARTICIPANTS`-sized field) needs
 * `MAX_PARTICIPANTS - 1` rounds; keep the manual Swiss cap in sync with it so
 * `plannedRounds` always fits regardless of pairing system (see D-round-robin
 * cap in the tournament review).
 */
export const MAX_PLANNED_ROUNDS = MAX_PARTICIPANTS - 1
/** Sanity cap per side of a match result (best-of-3 … best-of-9). */
export const MAX_GAMES_PER_MATCH = 9
/** Games recorded for the winner when a result is entered as a plain win. */
export const DEFAULT_WIN_GAMES = 2
export const POINTS_LOSS = 0
/** Deck snapshot keeps at most this many rule-violation messages. */
export const MAX_SNAPSHOT_ISSUES = 10
/** Decks one participant can play in a tournament (several are common: a main deck and a second one). */
export const MAX_DECKS_PER_PARTICIPANT = 5
/** The longest deck name typed in for a participant. */
export const DECK_NAME_MAX_LENGTH = 60

// --- Deck snapshot ---------------------------------------------------------

export interface TournamentDeckSnapshotCard {
  catalogCardId: number
  name: string
  /** Official German name (ADR 0015); missing in snapshots taken before #34 F3c. */
  nameDe?: string | null
  quantity: number
}

export interface TournamentDeckSnapshot {
  /** The deck this was copied from. It may have been edited or deleted since. */
  deckId: string
  name: string
  /** Name of the tournament format the snapshot was checked against, if any. */
  formatName?: string
  /**
   * Id of that format, so the UI can show a built-in format's name in the
   * interface language. Missing in snapshots taken before #34 F2c.
   */
  formatId?: string
  sections: {
    main: TournamentDeckSnapshotCard[]
    extra: TournamentDeckSnapshotCard[]
    side: TournamentDeckSnapshotCard[]
  }
  counts: { main: number, extra: number, side: number, total: number }
  /**
   * Frozen verdict; null when the tournament has no format. `issues` holds
   * the issue messages (German before #34 F2c, canonical English since);
   * `issueDetails` the same issues as code + params, which the UI renders in
   * the interface language. Older snapshots have only `issues`.
   */
  validation: { legal: boolean, issueCount: number, issues: string[], issueDetails?: ValidationIssue[] } | null
  /** ISO 8601 instant the snapshot was taken. */
  capturedAt: string
}

// --- Response DTOs (ISO string dates — see D10) ----------------------------

export interface TournamentFormatRef {
  id: string
  name: string
  isBuiltin: boolean
}

export interface TournamentParticipantDto {
  id: string
  name: string
  /** True when the row is linked to an app user (never exposes who). */
  linked: boolean
  /** True when the row is the calling user. */
  isSelf: boolean
  /** Left the tournament; past results count, no further pairings. */
  dropped: boolean
  /**
   * Taken out of the standings by the organizer (ADR 0031): none of this
   * participant's matches count for anybody, and they are listed last.
   */
  withdrawn: boolean
  /** Duel queue only: thrown out, completely out of the standing. */
  disqualified: boolean
  /** Duel queue only: what was decided for the duels of a player who left; null while undecided. */
  dropOption: DropOption | null
  seed: number
  /** The decks this participant plays, in the order they were added; empty = none yet. */
  decks: TournamentParticipantDeckDto[]
  createdAt: string
}

/** One deck of a participant (ADR 0039): a registered decklist or just a name. */
export interface TournamentParticipantDeckDto {
  id: string
  /** The deck's name, or the text that was typed. */
  name: string
  /**
   * The deck the list was copied from, while it exists and the caller may open
   * it (the organizer and the owner of the row); otherwise null.
   */
  deckId: string | null
  /** True when a decklist was registered; false for a name only. Anyone can see this. */
  hasList: boolean
  /** Against the tournament's format when it was registered; null = a name only, or no format. */
  legal: boolean | null
  issueCount: number | null
  /**
   * Full decklist. Visible to the organizer, to the owner of the row, and to
   * everyone once the tournament is finished; otherwise null.
   */
  snapshot: TournamentDeckSnapshot | null
}

/** A deck the caller can put on a participant, for the deck dialog's list. */
export interface TournamentDeckOption {
  id: string
  name: string
}

/** Whose decks `TournamentDeckOptions` lists, and why that may be fewer than all of them. */
export type TournamentDeckOptionsSource = 'own' | 'shared'

export interface TournamentDeckOptions {
  source: TournamentDeckOptionsSource
  items: TournamentDeckOption[]
}

export interface TournamentMatchDto {
  id: string
  roundId: string
  roundNumber: number
  tableNumber: number
  participantAId: string
  participantAName: string
  /** null = bye. */
  participantBId: string | null
  participantBName: string | null
  winnerParticipantId: string | null
  gamesA: number
  gamesB: number
  /** Only legacy results: new results are never draws (ADR 0031). */
  isDraw: boolean
  isBye: boolean
  /**
   * One of the two players is withdrawn, so the match is not scored and needs
   * no result (an unplayed one shows as "spielfrei" for the opponent).
   */
  voided: boolean
  reported: boolean
  reportedAt: string | null
}

export interface TournamentRoundDto {
  id: string
  number: number
  status: RoundStatus
  matches: TournamentMatchDto[]
  createdAt: string
  completedAt: string | null
}

export interface TournamentStandingRow extends StandingsRow {
  name: string
}

// --- Duel queue (ADR 0042) ----------------------------------------------------

export interface QueueDuelDto {
  id: string
  /** The round (Swiss) or Spieltag the duel is shown under. */
  round: number
  kind: DuelKind
  status: DuelStatus
  participantAId: string
  participantAName: string
  participantBId: string
  participantBName: string
  winnerParticipantId: string | null
  /** Games each player won, entered with the result of a best-of-3 duel; null for a single game or a duel not played. */
  gamesA: number | null
  gamesB: number | null
  /** The table of a running or a played duel. */
  tableNumber: number | null
  startedAt: string | null
  endedAt: string | null
  /** 1 = next up; null when the duel is not waiting (or one of its players left). */
  queuePosition: number | null
  /** A single game (1) or best of three (3), chosen for this duel (a Spielabend); null = what the tournament says. */
  bestOf: BestOf | null
}

export interface QueueTableRowDto {
  participantId: string
  name: string
  /** Equal for a tie; null for a player who left (listed grey, last). */
  place: number | null
  wins: number
  /** Points by the scoring of the tournament (3 for a win, with a score of a best-of-3 duel more or less). */
  points: number
  played: number
  /** The Spieltage the player has played on (shown first in the table). */
  matchdays: number
  /** Duels still to play. */
  open: number
  /** Duels lost. */
  losses: number
  /** The games won and lost in all duels (a single game counts as 1:0); their difference breaks a tie on points. */
  gamesWon: number
  gamesLost: number
  left: boolean
  tied: boolean
  /** The table the player is playing at right now. */
  tableNumber: number | null
  /** The player's place in the queue (1 = next up) while they wait for a table. */
  queuePosition: number | null
}

export interface QueuePendingRematchDto {
  participantAId: string
  participantAName: string
  participantBId: string
  participantBName: string
}

export interface QueueDetail {
  mode: QueueMode
  /** R; null for a round robin. */
  rounds: number | null
  prelaunch: boolean
  flow: QueueFlow
  bestOf: BestOf
  tables: number
  duelMinutes: number
  /** The table, sorted; shown fixed at the top of the page. */
  table: QueueTableRowDto[]
  /** Every duel of the schedule, struck ones included. */
  duels: QueueDuelDto[]
  /** Make-up duels between players who have met before: the organizer confirms each one. */
  pendingRematches: QueuePendingRematchDto[]
  /** Players who left and wait for the organizer to decide between A and B. */
  undecided: string[]
  /** What the organizer may choose for each player who is still playing (organizer only). */
  dropOptions: Record<string, { A: boolean, B: boolean }>
  /** Minutes the rest of the tournament takes at the pace planned, or null when it is over. */
  remainingMinutes: number | null
  /** Players level on first place after the last duel: a deciding duel is due. */
  firstPlaceTie: string[]
  /** The Swiss pairings that have not started could be drawn again (organizer only). */
  canRecompute: boolean
  /** Every duel is played and the organizer could add one more Spieltag (organizer only, while the tournament runs). */
  canExtend: boolean
  duelsDone: number
  duelsTotal: number
}

export interface TournamentListItem {
  id: string
  name: string
  description: string | null
  status: TournamentStatus
  pairingSystem: PairingSystem
  engine: TournamentEngine
  queueMode: QueueMode | null
  format: TournamentFormatRef | null
  organizerName: string
  role: TournamentRole
  participantCount: number
  roundCount: number
  plannedRounds: number | null
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  updatedAt: string
}

export interface TournamentListResponse {
  items: TournamentListItem[]
  total: number
  page: number
  pageSize: number
}

export interface TournamentDetail {
  id: string
  name: string
  description: string | null
  status: TournamentStatus
  pairingSystem: PairingSystem
  scoring: ScoringSystem
  byeScoring: ByeScoring
  plannedRounds: number | null
  /** 'queue' = the duel queue of ADR 0042; `queue` carries its state. */
  engine: TournamentEngine
  /** The settings of a duel queue (editable until the start), or null for a classic tournament. */
  queueSetup: QueueSetupDto | null
  /** The schedule, table and queue of a started duel-queue tournament, else null. */
  queue: QueueDetail | null
  format: TournamentFormatRef | null
  organizerName: string
  role: TournamentRole
  /** The caller's own participant row, when they play in the tournament. */
  selfParticipantId: string | null
  participants: TournamentParticipantDto[]
  rounds: TournamentRoundDto[]
  /** The last round when it is still pending, else null. */
  currentRound: TournamentRoundDto | null
  standings: TournamentStandingRow[]
  /** Server-computed action gates so the UI never re-derives the state machine. */
  canStart: boolean
  canCreateRound: boolean
  canCompleteRound: boolean
  canFinish: boolean
  canEditPairings: boolean
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  updatedAt: string
}

/** The settings of a duel-queue tournament; chosen at the creation and changeable until the start. */
export interface QueueSetupDto {
  mode: QueueMode
  rounds: number | null
  prelaunch: boolean
  flow: QueueFlow
  bestOf: BestOf
  /** How a duel is worth points: the table is sorted by them. */
  scoring: ScoringSystem
  tables: number
  duelMinutes: number
}

// --- Error codes -----------------------------------------------------------

// Codes the API returns in `data.code`; the client shows `errors.api.<code>`.
export const TOURNAMENT_ERROR_CODES = [
  'invalid_body', 'invalid_name', 'invalid_description', 'invalid_pairing_system',
  'invalid_scoring', 'invalid_bye_scoring', 'invalid_planned_rounds', 'unknown_format', 'invalid_participant', 'user_not_found',
  'unknown_deck', 'empty_deck', 'invalid_result', 'invalid_swap',
  'organizer_only', 'invalid_deck_name', 'deck_limit', 'deck_exists', 'unknown_deck_entry',
  'not_enough_participants', 'too_many_participants', 'participant_exists',
  'registration_closed', 'tournament_started', 'tournament_finished', 'invalid_status',
  'round_not_complete', 'round_completed', 'results_missing', 'results_reported',
  'planned_rounds_reached', 'bye_not_editable', 'no_rounds',
  'draws_not_allowed', 'match_voided', 'pairings_fixed',
  // Duel queue (ADR 0042); the first seven are the codes of `validateSetup`.
  'too_few_players', 'rounds_missing', 'rounds_must_be_even', 'rounds_too_small', 'rounds_too_large',
  'tables_invalid', 'duel_minutes_invalid',
  'invalid_engine', 'invalid_mode', 'not_queue_tournament', 'classic_only', 'unknown_duel', 'duel_not_running',
  'invalid_winner', 'player_in_duel', 'drop_option_unavailable', 'nothing_to_decide', 'rematch_not_pending',
  'tournament_not_running', 'no_open_pairings',
  // Spieltage, best of 3 and the players named when the tournament is created.
  'invalid_flow', 'invalid_best_of', 'invalid_games', 'invalid_participants',
  // Extending a tournament by one more Spieltag (ADR 0044).
  'schedule_not_over',
  // The Spielabend (round 15): duels paired by hand.
  'not_free_tournament', 'invalid_pair', 'duel_not_open',
] as const
export type TournamentErrorCode = typeof TOURNAMENT_ERROR_CODES[number]

// --- Small helpers ---------------------------------------------------------

/** Swiss default: ceil(log2(n)), at least 1. 2→1, 4→2, 8→3, 16→4, 64→6. */
export function swissRoundCount(participantCount: number): number {
  if (participantCount < 2) {
    return 1
  }
  return Math.max(1, Math.ceil(Math.log2(participantCount)))
}

/** Round robin: n-1 rounds for an even field, n for an odd one (one bye each round). */
export function roundRobinRoundCount(participantCount: number): number {
  if (participantCount < 2) {
    return 0
  }
  return participantCount % 2 === 0 ? participantCount - 1 : participantCount
}

export function defaultPlannedRounds(system: PairingSystem, participantCount: number): number {
  return system === 'round_robin'
    ? roundRobinRoundCount(participantCount)
    : swissRoundCount(participantCount)
}
