import { createError, getRouterParam, readBody } from 'h3'
import { useDb } from '../../../../../db'
import { reportDuelResult } from '../../../../../utils/tournaments'
import { requireUser } from '../../../../../utils/session'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const duelId = getRouterParam(event, 'duelId')
  if (!id || !duelId) {
    throw createError({ statusCode: 404, statusMessage: 'Tournament not found' })
  }

  const user = await requireUser(event)
  return reportDuelResult(useDb(), user.id, id, duelId, await readBody(event))
})
