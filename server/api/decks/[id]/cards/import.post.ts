import { createError, getRouterParam, readBody } from 'h3'
import { useDb } from '../../../../db'
import { addDeckCards, inCardLocale, validateDeckAddCardsInput } from '../../../../utils/decks'
import { requireUser } from '../../../../utils/session'
import { resolveCardLocale } from '../../../../utils/ui-locale'

// A deck list (reviewed in the import dialog) added to a deck that exists: `{ cards: [{ catalog_card_id, section,
// quantity }] }`, the copies are added to the ones the deck already has.
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 404, statusMessage: 'Deck not found' })
  }

  const user = await requireUser(event)
  const cards = validateDeckAddCardsInput(await readBody(event))

  return inCardLocale(addDeckCards(useDb(), user.id, id, cards), await resolveCardLocale(event))
})
