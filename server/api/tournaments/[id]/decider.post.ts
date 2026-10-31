import { createError, getRouterParam } from 'h3'
import { useDb } from '../../../db'
import { scheduleDecider } from '../../../utils/tournaments'
import { requireUser } from '../../../utils/session'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 404, statusMessage: 'Tournament not found' })
  }

  const user = await requireUser(event)
  return scheduleDecider(useDb(), user.id, id)
})
