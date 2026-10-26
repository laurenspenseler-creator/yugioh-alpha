import { createError, readBody } from 'h3'
import { useDb } from '../../db'
import { matchFragments, MAX_FRAGMENT_PASSES, MAX_FRAGMENTS_PER_PASS } from '../../utils/card-fragments'
import { parseFragmentPasses } from '../../utils/card-fragments-input'
import { requireUser } from '../../utils/session'

/**
 * `POST /api/cards/match-fragments` `{ passes }` answers which cards the text of
 * a photo names (ADR 0040). `passes` are the readings of one photo: lists of
 * lines `{ text, heights }` (or plain text) that an OCR running in the browser
 * read from it, `heights` being how tall each word is relative to the photo's
 * usual word. Read-only; the page puts the cards into the usual review table.
 */
export default defineEventHandler(async (event) => {
  await requireUser(event)

  const passes = parseFragmentPasses((await readBody<{ passes?: unknown }>(event))?.passes)
  if (!passes) {
    throw createError({
      statusCode: 400,
      statusMessage: `passes must be 1-${MAX_FRAGMENT_PASSES} lists of at most ${MAX_FRAGMENTS_PER_PASS} lines`,
      data: { code: 'invalid_body' },
    })
  }

  return { matches: matchFragments(useDb(), passes) }
})
