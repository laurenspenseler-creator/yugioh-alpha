import { createError, readBody } from 'h3'
import { useDb } from '../../db'
import { handtrapCardIds, isHandtrapDefinition } from '../../utils/handtrap-lists'
import { loadCardNameRecords } from '../../utils/deck-validation'
import { requireUser } from '../../utils/session'
import { MAX_FILTER_ENTRIES } from '../../../shared/rule-formats'
import type { Rule } from '../../../shared/rule-formats'

/**
 * `POST /api/formats/handtraps` `{ definition, except? }` answers with the
 * rules for one definition of "hand traps" (ADR 0038): the cards it covers as
 * `forbidden` rules, 200 cards each, plus their names for the format editor.
 * Nothing is saved; the page puts the rules into the editor.
 */
export default defineEventHandler(async (event) => {
  await requireUser(event)

  const body = await readBody<{ definition?: unknown, except?: unknown }>(event)
  if (!isHandtrapDefinition(body?.definition)) {
    throw createError({ statusCode: 400, statusMessage: 'Unknown definition', data: { code: 'invalid_body' } })
  }
  const except = typeof body.except === 'string' && body.except.trim() !== '' ? body.except.trim().slice(0, 100) : undefined

  const db = useDb()
  const ids = handtrapCardIds(db, body.definition, except)

  const rules: Rule[] = []
  for (let start = 0; start < ids.length; start += MAX_FILTER_ENTRIES) {
    rules.push({ kind: 'card_status', status: 'forbidden', cardIds: ids.slice(start, start + MAX_FILTER_ENTRIES) })
  }

  return { rules, count: ids.length, ...loadCardNameRecords(db, ids) }
})
