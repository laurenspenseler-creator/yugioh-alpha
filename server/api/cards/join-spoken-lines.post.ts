import { createError, readBody } from 'h3'
import { useDb } from '../../db'
import { joinSpokenLines, MAX_SPOKEN_LINE_LENGTH, MAX_SPOKEN_LINES } from '../../utils/spoken-lines'
import { requireUser } from '../../utils/session'

/**
 * `POST /api/cards/join-spoken-lines` `{ lines }` answers the dictated card lines with the
 * neighbours joined that are one card cut in two by a pause (ADR 0040). Read-only.
 */
export default defineEventHandler(async (event) => {
  await requireUser(event)

  const lines = (await readBody<{ lines?: unknown }>(event))?.lines
  if (!Array.isArray(lines) || lines.length > MAX_SPOKEN_LINES || !lines.every(line => typeof line === 'string' && line.length <= MAX_SPOKEN_LINE_LENGTH)) {
    throw createError({
      statusCode: 400,
      statusMessage: `lines must be at most ${MAX_SPOKEN_LINES} strings of at most ${MAX_SPOKEN_LINE_LENGTH} characters`,
      data: { code: 'invalid_body' },
    })
  }

  return { lines: joinSpokenLines(useDb(), lines as string[]) }
})
