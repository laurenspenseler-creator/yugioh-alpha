// Puts the Classic Plus card list (scripts/classic-plus/card-list-v31.json) into overrides.json as fixed limits (ADR 0045, 0050):
// every card of the list gets its `maxCopies`, the rules of the list as hits and a note. Run in the repo root with Node 24, then
// `node scripts/classic-plus/combine.ts --allow-missing` to make the banlist:
//
//   node scripts/classic-plus/apply-card-list.ts
//
// The list is the authors' card list ("Teil 3" of the hand-over of 16 November 2026) plus the cards the new rules 4 (Spells and Traps
// from the hand, Ä17) and 12 (alternative win conditions, Ä12) hit by their wording: those carry `source: "rule-text"` and are for the
// authors to confirm. Cards of overrides.json that are not in the list stay as they are.

import { readFileSync, writeFileSync } from 'node:fs'

interface ListedCard {
  id: number
  name: string
  limit: 0 | 1 | 2 | 3
  rules: string[]
  rule: string
  note: string
  source: 'list' | 'rule-text'
}

const listPath = new URL('./card-list-v31.json', import.meta.url)
const overridesPath = new URL('./overrides.json', import.meta.url)
const { cards } = JSON.parse(readFileSync(listPath, 'utf8')) as { cards: ListedCard[] }
const overrides = JSON.parse(readFileSync(overridesPath, 'utf8')) as Record<string, { hits: Array<{ rule: string, reason: string }>, maxCopies?: number, note?: string }>

const SOURCES = { 'list': 'v3.1 card list (16 Nov 2026)', 'rule-text': 'v3.1 rule text, not in the card list' }
let added = 0
let changed = 0
for (const card of cards) {
  const key = String(card.id)
  const existed = overrides[key]
  const reason = SOURCES[card.source]
  const note = [
    `${reason}: ${card.name}.`,
    card.rule ? `Rule: ${card.rule}.` : '',
    card.note ? card.note.replace(/\.?$/, '.') : '',
    card.source === 'rule-text' ? 'For the rule authors to confirm.' : '',
  ].filter(Boolean).join(' ')
  const next = {
    // The rules of the list; a card the list does not give a rule for (an unlimited one, rule 1) keeps the hits it had.
    hits: card.rules.length > 0 ? card.rules.map(rule => ({ rule, reason })) : (existed?.hits ?? []),
    maxCopies: card.limit,
    note,
  }
  if (!existed) {
    added += 1
  }
  else if (existed.maxCopies !== card.limit) {
    changed += 1
  }
  overrides[key] = next
}

const sorted = Object.fromEntries(Object.entries(overrides).sort(([a], [b]) => Number(a) - Number(b)))
writeFileSync(overridesPath, `${JSON.stringify(sorted, null, 2)}\n`)
console.log(`card list: ${cards.length} cards; overrides: ${Object.keys(sorted).length} (${added} new, ${changed} with another limit than before)`)
