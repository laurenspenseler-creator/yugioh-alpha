import { createError, getRouterParam, readBody } from 'h3'
import { useDb } from '../../../db'
import { createEveningDuel } from '../../../utils/tournaments'
import { requireUser } from '../../../utils/session'

/**
 * `POST /api/tournaments/:id/free-duels` `{ participantAId, participantBId, bestOf }`: a new duel of a Spielabend, paired by
 * the organizer from the registered players; `bestOf` is 1 (a single game) or 3 for this duel.
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 404, statusMessage: 'Tournament not found' })
  }

  const user = await requireUser(event)
  return createEveningDuel(useDb(), user.id, id, await readBody(event))
})
