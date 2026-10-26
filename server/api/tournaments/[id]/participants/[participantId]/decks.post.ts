import { createError, getRouterParam, readBody } from 'h3'
import { useDb } from '../../../../../db'
import { addParticipantDeck, validateDeckEntryInput } from '../../../../../utils/tournaments'
import { requireUser } from '../../../../../utils/session'

// Adds a deck to a participant: `{ deckId }` for one of the app's decks, or
// `{ name }` for a deck that is only a name (ADR 0039).
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const participantId = getRouterParam(event, 'participantId')
  if (!id || !participantId) {
    throw createError({ statusCode: 404, statusMessage: 'Tournament not found' })
  }

  const user = await requireUser(event)
  const input = validateDeckEntryInput(await readBody(event))

  return addParticipantDeck(useDb(), user.id, id, participantId, input)
})
