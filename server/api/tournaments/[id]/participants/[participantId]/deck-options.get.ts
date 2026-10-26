import { createError, getRouterParam } from 'h3'
import { useDb } from '../../../../../db'
import { listParticipantDeckOptions } from '../../../../../utils/tournaments'
import { requireUser } from '../../../../../utils/session'

// The decks the caller can put on this participant: all of their own, or for
// another player with an account only the ones shared with the caller (ADR 0039).
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const participantId = getRouterParam(event, 'participantId')
  if (!id || !participantId) {
    throw createError({ statusCode: 404, statusMessage: 'Tournament not found' })
  }

  const user = await requireUser(event)

  return listParticipantDeckOptions(useDb(), user.id, id, participantId)
})
