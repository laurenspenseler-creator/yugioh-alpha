import { createError, getRouterParam, readBody } from 'h3'
import { useDb } from '../../../../../db'
import { decideParticipantLeave } from '../../../../../utils/tournaments'
import { requireUser } from '../../../../../utils/session'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const participantId = getRouterParam(event, 'participantId')
  if (!id || !participantId) {
    throw createError({ statusCode: 404, statusMessage: 'Tournament not found' })
  }

  const user = await requireUser(event)
  return decideParticipantLeave(useDb(), user.id, id, participantId, await readBody(event))
})
