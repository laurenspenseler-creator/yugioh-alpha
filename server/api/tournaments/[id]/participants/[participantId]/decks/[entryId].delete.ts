import { createError, getRouterParam } from 'h3'
import { useDb } from '../../../../../../db'
import { removeParticipantDeck } from '../../../../../../utils/tournaments'
import { requireUser } from '../../../../../../utils/session'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const participantId = getRouterParam(event, 'participantId')
  const entryId = getRouterParam(event, 'entryId')
  if (!id || !participantId || !entryId) {
    throw createError({ statusCode: 404, statusMessage: 'Tournament not found' })
  }

  const user = await requireUser(event)

  return removeParticipantDeck(useDb(), user.id, id, participantId, entryId)
})
