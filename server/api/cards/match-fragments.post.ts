import { createError, readBody } from 'h3'
import { useDb } from '../../db'
import { mergeArtCards, matchFragments, MAX_FRAGMENT_PASSES, MAX_FRAGMENTS_PER_PASS } from '../../utils/card-fragments'
import { parseArtCards } from '../../utils/card-art-input'
import { parseFragmentPasses } from '../../utils/card-fragments-input'
import { requireUser } from '../../utils/session'

/**
 * `POST /api/cards/match-fragments` `{ passes, art }` answers which cards a photo shows
 * (ADR 0040, 0041). `passes` are the readings of one photo: lists of lines `{ text, heights }`
 * (or plain text) that an OCR running in the browser read from it, `heights` being how tall each
 * word is relative to the photo's usual word. `art` are the cards the browser recognized by their
 * artwork; either may be left out (an empty `passes` is fine when there is `art`). Read-only; the
 * page puts the cards into the usual review table.
 */
export default defineEventHandler(async (event) => {
  await requireUser(event)

  const body = await readBody<{ passes?: unknown, art?: unknown }>(event)
  const art = body?.art === undefined ? [] : parseArtCards(body.art)
  // The text reading may have found nothing (or failed) when the artwork did find cards.
  const noText = body?.passes === undefined || (Array.isArray(body.passes) && body.passes.length === 0)
  const passes = noText && art && art.length > 0 ? [] : parseFragmentPasses(body?.passes)
  if (!passes || !art) {
    throw createError({
      statusCode: 400,
      statusMessage: `passes must be 1-${MAX_FRAGMENT_PASSES} lists of at most ${MAX_FRAGMENTS_PER_PASS} lines`,
      data: { code: 'invalid_body' },
    })
  }

  const db = useDb()
  // What resembled a name in the text, even too weakly to be a card, can confirm a doubtful artwork match.
  const evidence = new Map<number, number>()
  return { matches: mergeArtCards(db, passes.length > 0 ? matchFragments(db, passes, evidence) : [], art, evidence) }
})
