import { createError, getRouterParam, readBody } from 'h3'
import { useDb } from '../../../db'
import { recomputePairings } from '../../../utils/tournaments'
import { requireUser } from '../../../utils/session'

// "Neu berechnen" (Swiss): `{ apply: false }` shows what would change, `{ apply: true }` does it.
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 404, statusMessage: 'Tournament not found' })
  }

  const user = await requireUser(event)
  const body = await readBody(event)
  return recomputePairings(useDb(), user.id, id, Boolean(body && typeof body === 'object' && (body as Record<string, unknown>).apply === true))
})
