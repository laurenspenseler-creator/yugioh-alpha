// Errors of the tournament API (D11: every 400/403/409 carries `data.code`). Shared by the tournament
// operations (tournaments.ts) and the duel queue (queue-tournaments.ts).

import { createError } from 'h3'
import type { TournamentErrorCode } from '../../shared/tournaments'

// `params` are the named values the client's `errors.api.<code>` message
// needs (e.g. `{ max }`); the English `statusMessage` is never shown (ADR 0014).
export type ErrorParams = Record<string, string | number>

export function fail(statusCode: number, code: TournamentErrorCode, message: string, params?: ErrorParams): never {
  throw createError({ statusCode, statusMessage: message, data: params ? { code, params } : { code } })
}
export function badRequest(code: TournamentErrorCode, message: string, params?: ErrorParams): never {
  fail(400, code, message, params)
}
export function forbidden(code: TournamentErrorCode, message: string, params?: ErrorParams): never {
  fail(403, code, message, params)
}
export function conflict(code: TournamentErrorCode, message: string, params?: ErrorParams): never {
  fail(409, code, message, params)
}
export function notFound(): never {
  throw createError({ statusCode: 404, statusMessage: 'Tournament not found' })
}
