import { createError, getRouterParam } from 'h3'
import { useDb } from '../../../../db'
import { removeEveningDuel } from '../../../../utils/tournaments'
import { requireUser } from '../../../../utils/session'

/** `DELETE /api/tournaments/:id/free-duels/:duelId`: takes back a duel of a Spielabend that was paired by mistake (not played yet). */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const duelId = getRouterParam(event, 'duelId')
  if (!id || !duelId) {
    throw createError({ statusCode: 404, statusMessage: 'Tournament not found' })
  }

  const user = await requireUser(event)
  return removeEveningDuel(useDb(), user.id, id, duelId)
})
