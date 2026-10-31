// The duel queue (ADR 0042) on the database: loads the duels as a pure state (shared/tournament-*.ts), lets the
// pure modules decide what happens next, and writes the outcome back. Nothing in here knows a rule of its own: the
// pairing, the pool, the options of a dropout and the order of the queue all come from the shared modules.
//
// The tournament moves on by itself. After every change `advanceQueue` pairs the Swiss round that is due, fills the
// pool with make-up duels (a rematch waits for the organizer), and starts the next duels on the free tables, so the
// organizer only ever enters winners.

import { randomUUID } from 'node:crypto'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import type { useDb } from '../db'
import { tournament, tournamentDuel, tournamentParticipant } from '../db/schema'
import { badRequest, conflict, fail } from './tournament-errors'
import type { DropOption, Duel, DuelPlayer, DuelsState } from '../../shared/tournament-duels'
import { isLive, openDuelsOf } from '../../shared/tournament-duels'
import { decideLeave, dropOptions, leaveTournament, poolDuels, recomputeSwiss } from '../../shared/tournament-dropout'
import type { LeaveKind } from '../../shared/tournament-dropout'
import { startingSchedule, swissRoundDue } from '../../shared/tournament-flow'
import type { FlowSetup, NewDuel } from '../../shared/tournament-flow'
import {
  DEFAULT_DUEL_MINUTES,
  maxEvenRounds,
  swissRounds,
  usableTables,
  validateSetup,
} from '../../shared/tournament-modes'
import type { QueueMode } from '../../shared/tournament-modes'
import { planQueue, queuePositions } from '../../shared/tournament-queue'
import { computeTable } from '../../shared/tournament-table'
import type {
  QueueDetail,
  QueueDuelDto,
  QueuePendingRematchDto,
  QueueSetupDto,
  QueueTableRowDto,
  TournamentErrorCode,
  TournamentRole,
} from '../../shared/tournaments'

type Db = ReturnType<typeof useDb>
type TournamentRow = typeof tournament.$inferSelect
type ParticipantRow = typeof tournamentParticipant.$inferSelect
type DuelRow = typeof tournamentDuel.$inferSelect

/** The most Champions League duels a player has when the organizer does not say. */
const DEFAULT_CHAMPIONS_LEAGUE_ROUNDS = 6

// --- The state, loaded and written back ---------------------------------------------

export function queueSetupOf(row: TournamentRow): QueueSetupDto {
  const mode: QueueMode = row.queueMode ?? 'round_robin'
  return {
    mode,
    rounds: mode === 'round_robin' ? null : row.plannedRounds,
    prelaunch: mode === 'swiss' && row.prelaunch,
    tables: row.tables ?? 1,
    duelMinutes: row.duelMinutes ?? DEFAULT_DUEL_MINUTES,
  }
}

function flowSetupOf(row: TournamentRow): FlowSetup {
  const setup = queueSetupOf(row)
  return { mode: setup.mode, rounds: setup.rounds, prelaunch: setup.prelaunch }
}

function toPlayer(participant: ParticipantRow): DuelPlayer {
  return {
    id: participant.id,
    seed: participant.seed,
    status: participant.disqualified ? 'disqualified' : participant.dropped ? 'dropped' : 'active',
    dropOption: participant.dropOption,
  }
}

function toDuel(row: DuelRow): Duel {
  return {
    id: row.id,
    a: row.participantAId,
    b: row.participantBId,
    round: row.round,
    kind: row.kind,
    status: row.status,
    winner: row.winnerParticipantId,
    table: row.tableNumber,
    startedAt: row.startedAt ? row.startedAt.getTime() : null,
    endedAt: row.endedAt ? row.endedAt.getTime() : null,
  }
}

function loadDuelRows(db: Db, tournamentId: string): DuelRow[] {
  return db.select().from(tournamentDuel).where(eq(tournamentDuel.tournamentId, tournamentId)).orderBy(asc(tournamentDuel.position)).all()
}

function loadParticipantRows(db: Db, tournamentId: string): ParticipantRow[] {
  return db.select().from(tournamentParticipant).where(eq(tournamentParticipant.tournamentId, tournamentId)).orderBy(asc(tournamentParticipant.seed)).all()
}

function stateOf(row: TournamentRow, participants: ParticipantRow[], duelRows: DuelRow[]): DuelsState {
  return { players: participants.map(toPlayer), duels: duelRows.map(toDuel), pauses: row.queuePauses ?? [] }
}

function loadState(db: Db, row: TournamentRow): DuelsState {
  return stateOf(row, loadParticipantRows(db, row.id), loadDuelRows(db, row.id))
}

function freshRow(db: Db, tournamentId: string): TournamentRow {
  return db.select().from(tournament).where(eq(tournament.id, tournamentId)).get()!
}

function insertDuels(db: Db, tournamentId: string, duels: readonly NewDuel[], now: Date): void {
  if (duels.length === 0) {
    return
  }
  const last = db
    .select({ position: sql<number | null>`max(${tournamentDuel.position})` })
    .from(tournamentDuel)
    .where(eq(tournamentDuel.tournamentId, tournamentId))
    .get()?.position ?? 0
  db.insert(tournamentDuel).values(duels.map((duel, index) => ({
    id: randomUUID(),
    tournamentId,
    participantAId: duel.a,
    participantBId: duel.b,
    round: duel.round,
    kind: duel.kind,
    status: 'planned' as const,
    position: last + index + 1,
    createdAt: now,
  }))).run()
}

/** Writes the duels whose status or table differs from the stored ones (a dropout strikes duels). */
function persistDuelChanges(db: Db, before: DuelsState, after: DuelsState): void {
  const was = new Map(before.duels.map(duel => [duel.id, duel]))
  for (const duel of after.duels) {
    const old = was.get(duel.id)
    if (old && (old.status !== duel.status || old.table !== duel.table)) {
      db.update(tournamentDuel).set({ status: duel.status, tableNumber: duel.table }).where(eq(tournamentDuel.id, duel.id)).run()
    }
  }
}

// --- Moving on ---------------------------------------------------------------------

/**
 * Brings the tournament up to date after a change: pairs what is due (Swiss round, make-up duels), then starts the next
 * duels on the free tables. Safe to call any time; does nothing unless the tournament is running.
 */
export function advanceQueue(db: Db, tournamentId: string, now: Date): void {
  for (let guard = 0; guard < 200; guard += 1) {
    const row = freshRow(db, tournamentId)
    if (row.status !== 'running') {
      return
    }
    const setup = flowSetupOf(row)
    const state = loadState(db, row)

    const due = swissRoundDue(state, setup)
    if (due) {
      insertDuels(db, tournamentId, [...due.duels, ...(due.makeup ? [due.makeup] : [])], now)
      if (due.pause) {
        db.update(tournament).set({ queuePauses: [...(row.queuePauses ?? []), due.pause] }).where(eq(tournament.id, tournamentId)).run()
      }
      continue
    }

    const makeups = poolDuels(state, setup).filter(duel => duel.kind === 'makeup')
    if (makeups.length > 0) {
      insertDuels(db, tournamentId, makeups, now)
      continue
    }
    break
  }

  const row = freshRow(db, tournamentId)
  if (row.status !== 'running') {
    return
  }
  const order = planQueue(loadState(db, row), row.tables ?? 1, (row.startedAt ?? now).getTime())
  for (const entry of order.start) {
    db.update(tournamentDuel).set({ status: 'running', tableNumber: entry.table, startedAt: now }).where(eq(tournamentDuel.id, entry.duelId)).run()
  }
  db.update(tournament).set({ updatedAt: now }).where(eq(tournament.id, tournamentId)).run()
}

// --- Starting -----------------------------------------------------------------------

/** R when the organizer left it open: the rule of thumb for Swiss, a short league for the Champions League. */
export function defaultRounds(mode: QueueMode, players: number, prelaunch: boolean): number | null {
  if (mode === 'round_robin') {
    return null
  }
  const most = Math.max(2, maxEvenRounds(players))
  const wanted = mode === 'swiss' ? swissRounds(players, prelaunch) : DEFAULT_CHAMPIONS_LEAGUE_ROUNDS
  return Math.min(wanted, most)
}

/**
 * Starts a duel-queue tournament: checks the setup with the number of players there are now, draws the fixed
 * schedule (a Swiss tournament only its first rounds) and starts the first duels.
 */
export function startQueueTournament(db: Db, row: TournamentRow, participants: ParticipantRow[], now: Date): void {
  const setup = queueSetupOf(row)
  const rounds = setup.rounds ?? defaultRounds(setup.mode, participants.length, setup.prelaunch)
  const issues = validateSetup({
    mode: setup.mode,
    players: participants.length,
    rounds,
    tables: setup.tables,
    duelMinutes: setup.duelMinutes,
    prelaunch: setup.prelaunch,
  })
  if (issues.length > 0) {
    const issue = issues[0]!
    badRequest(issue.code as TournamentErrorCode, `Invalid setup: ${issue.code}`, issue.params)
  }

  const schedule = startingSchedule({ mode: setup.mode, rounds, prelaunch: setup.prelaunch }, participants.map(p => p.id))

  participants.forEach((participant, index) => {
    db.update(tournamentParticipant).set({ seed: index + 1, updatedAt: now }).where(eq(tournamentParticipant.id, participant.id)).run()
  })
  db.update(tournament).set({
    status: 'running',
    plannedRounds: rounds,
    startedAt: now,
    queuePauses: schedule.pauses,
    updatedAt: now,
  }).where(eq(tournament.id, row.id)).run()
  insertDuels(db, row.id, schedule.duels, now)
  advanceQueue(db, row.id, now)
}

// --- Results ------------------------------------------------------------------------

/** The winner of a duel (best of one). A running duel ends here; a finished one can be corrected. */
export function reportQueueDuel(db: Db, row: TournamentRow, duelId: string, winnerId: unknown, now: Date): void {
  if (row.status !== 'running') {
    conflict('tournament_not_running', 'The tournament is not running')
  }
  const duel = db.select().from(tournamentDuel).where(and(eq(tournamentDuel.id, duelId), eq(tournamentDuel.tournamentId, row.id))).get()
  if (!duel) {
    fail(404, 'unknown_duel', 'Duel not found')
  }
  if (typeof winnerId !== 'string' || (winnerId !== duel.participantAId && winnerId !== duel.participantBId)) {
    badRequest('invalid_winner', 'The winner must be one of the two players')
  }
  if (duel.status === 'running') {
    db.update(tournamentDuel).set({ status: 'done', winnerParticipantId: winnerId, endedAt: now }).where(eq(tournamentDuel.id, duelId)).run()
    advanceQueue(db, row.id, now)
  }
  else if (duel.status === 'done') {
    // A correction only changes the table; the pairings stay as they are (the Swiss ones until they are drawn again).
    db.update(tournamentDuel).set({ winnerParticipantId: winnerId }).where(eq(tournamentDuel.id, duelId)).run()
    db.update(tournament).set({ updatedAt: now }).where(eq(tournament.id, row.id)).run()
  }
  else {
    conflict('duel_not_running', 'This duel is not running')
  }
}

// --- Leaving ------------------------------------------------------------------------

function requireRunning(row: TournamentRow): void {
  if (row.status !== 'running') {
    conflict('tournament_not_running', 'The tournament is not running')
  }
}

/** A player leaves or is disqualified. `option` null = the organizer decides later (not for a disqualification). */
export function leaveQueuePlayer(db: Db, row: TournamentRow, participantId: string, kind: LeaveKind, option: DropOption | null, now: Date): void {
  requireRunning(row)
  const before = loadState(db, row)
  const player = before.players.find(candidate => candidate.id === participantId)
  if (!player) {
    fail(404, 'invalid_participant', 'Participant not found')
  }
  if (player.status !== 'active') {
    conflict('nothing_to_decide', 'This player has already left')
  }
  if (before.duels.some(duel => duel.status === 'running' && (duel.a === participantId || duel.b === participantId))) {
    conflict('player_in_duel', 'The player is in a running duel')
  }
  const setup = flowSetupOf(row)
  if (kind === 'dropped' && option !== null && !dropOptions(before, setup, participantId)[option]) {
    conflict('drop_option_unavailable', 'This option does not add up')
  }

  const after = leaveTournament(before, participantId, kind, option)
  db.update(tournamentParticipant).set({
    dropped: true,
    disqualified: kind === 'disqualified',
    dropOption: kind === 'disqualified' ? 'A' : option,
    updatedAt: now,
  }).where(eq(tournamentParticipant.id, participantId)).run()
  persistDuelChanges(db, before, after)
  advanceQueue(db, row.id, now)
}

/** The organizer decides what happens to the duels of a player who left undecided. */
export function decideQueueLeave(db: Db, row: TournamentRow, participantId: string, option: DropOption, now: Date): void {
  requireRunning(row)
  const before = loadState(db, row)
  const player = before.players.find(candidate => candidate.id === participantId)
  if (!player || player.status !== 'dropped' || player.dropOption !== null) {
    conflict('nothing_to_decide', 'There is nothing to decide for this player')
  }
  if (!dropOptions(before, flowSetupOf(row), participantId)[option]) {
    conflict('drop_option_unavailable', 'This option does not add up')
  }
  const after = decideLeave(before, participantId, option)
  db.update(tournamentParticipant).set({ dropOption: option, updatedAt: now }).where(eq(tournamentParticipant.id, participantId)).run()
  persistDuelChanges(db, before, after)
  advanceQueue(db, row.id, now)
}

// --- Rematches, redraw, decider -----------------------------------------------------

/** Make-up duels between players who have met before: only fixed when the organizer says so. */
function pendingRematchesOf(state: DuelsState, setup: FlowSetup): NewDuel[] {
  return poolDuels(state, setup).filter(duel => duel.kind === 'rematch')
}

export function confirmQueueRematch(db: Db, row: TournamentRow, aId: string, bId: string, now: Date): void {
  requireRunning(row)
  const pending = pendingRematchesOf(loadState(db, row), flowSetupOf(row))
  const found = pending.find(duel => (duel.a === aId && duel.b === bId) || (duel.a === bId && duel.b === aId))
  if (!found) {
    conflict('rematch_not_pending', 'This rematch is not due')
  }
  insertDuels(db, row.id, [found], now)
  advanceQueue(db, row.id, now)
}

export interface RecomputePreview {
  round: number
  removed: Array<{ participantAId: string, participantBId: string }>
  added: Array<{ participantAId: string, participantBId: string }>
}

/** What "Neu berechnen" would change: the Swiss pairings that have not started, drawn again from the table as it is. */
export function previewQueueRecompute(db: Db, row: TournamentRow): RecomputePreview[] {
  if (row.queueMode !== 'swiss') {
    return []
  }
  return recomputeSwiss(loadState(db, row)).map(change => ({
    round: change.round,
    removed: change.removed.map(duel => ({ participantAId: duel.a, participantBId: duel.b })),
    added: change.added.map(duel => ({ participantAId: duel.a, participantBId: duel.b })),
  }))
}

export function applyQueueRecompute(db: Db, row: TournamentRow, now: Date): void {
  requireRunning(row)
  const changes = row.queueMode === 'swiss' ? recomputeSwiss(loadState(db, row)) : []
  if (changes.length === 0) {
    conflict('no_open_pairings', 'There is nothing to draw again')
  }
  for (const change of changes) {
    db.delete(tournamentDuel).where(inArray(tournamentDuel.id, change.removed.map(duel => duel.id))).run()
    insertDuels(db, row.id, change.added, now)
  }
  advanceQueue(db, row.id, now)
}

/** The players level on first place once every duel is played (the tie the table could not break). */
function firstPlaceTieOf(state: DuelsState): string[] {
  if (state.duels.some(duel => (duel.status === 'planned' || duel.status === 'running') && isLive(state, duel))) {
    return []
  }
  const first = computeTable(state).filter(tableRow => tableRow.place === 1)
  return first.length > 1 ? first.map(tableRow => tableRow.playerId) : []
}

/** One deciding duel for first place between two of the players who are level (more than two: the lot decides who plays). */
export function scheduleQueueDecider(db: Db, row: TournamentRow, now: Date): void {
  requireRunning(row)
  const state = loadState(db, row)
  const tied = firstPlaceTieOf(state)
  if (tied.length < 2) {
    conflict('rematch_not_pending', 'There is no tie for first place')
  }
  const pair = [...tied].sort(() => Math.random() - 0.5).slice(0, 2)
  insertDuels(db, row.id, [{ a: pair[0]!, b: pair[1]!, round: Math.max(1, ...state.duels.map(duel => duel.round)), kind: 'decider' }], now)
  advanceQueue(db, row.id, now)
}

// --- Detail -------------------------------------------------------------------------

export function buildQueueDetail(db: Db, row: TournamentRow, participants: ParticipantRow[], role: TournamentRole): QueueDetail {
  const setup = queueSetupOf(row)
  const flow = flowSetupOf(row)
  const duelRows = loadDuelRows(db, row.id)
  const state = stateOf(row, participants, duelRows)
  const nameOf = new Map(participants.map(participant => [participant.id, participant.name]))
  const order = planQueue(state, setup.tables, (row.startedAt ?? row.createdAt).getTime())
  const positions = queuePositions(state, order)
  const waitingIndex = new Map(order.waiting.map((duel, index) => [duel.id, index + 1]))

  const running = new Map<string, number>()
  for (const duel of state.duels) {
    if (duel.status === 'running' && duel.table !== null) {
      running.set(duel.a, duel.table)
      running.set(duel.b, duel.table)
    }
  }

  const table: QueueTableRowDto[] = computeTable(state).map(tableRow => ({
    participantId: tableRow.playerId,
    name: nameOf.get(tableRow.playerId) ?? '',
    place: tableRow.place,
    wins: tableRow.wins,
    played: tableRow.played,
    open: tableRow.left ? 0 : openDuelsOf(state, tableRow.playerId).filter(duel => isLive(state, duel)).length,
    buchholz: tableRow.buchholz,
    left: tableRow.left,
    tied: tableRow.tied,
    tableNumber: running.get(tableRow.playerId) ?? null,
    queuePosition: positions.get(tableRow.playerId) ?? null,
  }))

  const duels: QueueDuelDto[] = duelRows.map(duelRow => ({
    id: duelRow.id,
    round: duelRow.round,
    kind: duelRow.kind,
    status: duelRow.status,
    participantAId: duelRow.participantAId,
    participantAName: nameOf.get(duelRow.participantAId) ?? '',
    participantBId: duelRow.participantBId,
    participantBName: nameOf.get(duelRow.participantBId) ?? '',
    winnerParticipantId: duelRow.winnerParticipantId,
    tableNumber: duelRow.tableNumber,
    startedAt: duelRow.startedAt ? duelRow.startedAt.toISOString() : null,
    endedAt: duelRow.endedAt ? duelRow.endedAt.toISOString() : null,
    queuePosition: waitingIndex.get(duelRow.id) ?? null,
  }))

  const organizer = role === 'organizer'
  const running_ = row.status === 'running'
  const pendingRematches: QueuePendingRematchDto[] = running_
    ? pendingRematchesOf(state, flow).map(duel => ({
        participantAId: duel.a,
        participantAName: nameOf.get(duel.a) ?? '',
        participantBId: duel.b,
        participantBName: nameOf.get(duel.b) ?? '',
      }))
    : []

  const openDuels = state.duels.filter(duel => (duel.status === 'planned' || duel.status === 'running') && isLive(state, duel)).length
  const activeCount = state.players.filter(player => player.status === 'active').length
  const remainingMinutes = running_ && openDuels > 0
    ? Math.ceil(openDuels / usableTables(setup.tables, Math.max(2, activeCount))) * setup.duelMinutes
    : null

  const dropChoices: Record<string, { A: boolean, B: boolean }> = {}
  if (organizer && running_) {
    for (const player of state.players.filter(candidate => candidate.status === 'active')) {
      dropChoices[player.id] = dropOptions(state, flow, player.id)
    }
  }

  return {
    mode: setup.mode,
    rounds: setup.rounds,
    prelaunch: setup.prelaunch,
    tables: setup.tables,
    duelMinutes: setup.duelMinutes,
    table,
    duels,
    pendingRematches,
    undecided: state.players.filter(player => player.status === 'dropped' && player.dropOption === null).map(player => player.id),
    dropOptions: dropChoices,
    remainingMinutes,
    firstPlaceTie: running_ ? firstPlaceTieOf(state) : [],
    canRecompute: organizer && running_ && row.queueMode === 'swiss' && recomputeSwiss(state).length > 0,
    duelsDone: state.duels.filter(duel => duel.status === 'done').length,
    duelsTotal: state.duels.filter(duel => duel.status !== 'void').length,
  }
}
