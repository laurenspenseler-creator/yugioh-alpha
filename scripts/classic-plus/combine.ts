// Classic Plus, step 3: collects the classifier's results, checks them, and
// turns every card's rule hits into the Classic Plus banlist.
//
//   node scripts/classic-plus/combine.ts [--allow-missing]
//
// Reads:
//   work/cards.json         the card pool (written by prefilter.ts)
//   work/results/*.jsonl    fresh classifier output, one file per batch
//   classifications.jsonl   earlier classifications (committed; the cache)
//   overrides.json          manual corrections after review (committed)
// Writes:
//   classifications.jsonl                   the cache, merged with the fresh results
//   review.csv                              every restricted or flagged card, for review
//   server/utils/classic-plus-banlist.json  Forbidden / Limited / Semi-Limited card ids
//   server/utils/classic-plus-handtraps.json  the cards that hit rule 4 (hand traps)
//
// A card's status is the strictest limit of the rule steps it hits (0, 1 or 2
// copies: Forbidden, Limited, Semi-Limited). Rule 2 is forbidden. Rule 1 is
// the format's card-type filter; the few rule 1 cards whose type the filter
// can't see (Pendulum "Spirit Monster"s) are forbidden here. On top, the two
// cross-cutting rules:
//   - frequency modifier: a limited card whose limiting effect one copy can
//     activate more than once per turn is forbidden instead
//   - stacking rule: 9a (protection from card effects) plus 6b (multiplied
//     battle damage) is forbidden
//
// Rule 8 applies to Extra Deck monsters too (v3.1, Ä1). An override may carry
// `maxCopies`: then that is the card's final limit whatever its hits say (the
// Classic Plus v3.1 card list, ADR 0045); the hits are only its reasons.
//
// See docs/adr/0022-classic-plus-format.md and docs/adr/0045-classic-plus-v3-1.md.

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import {
  applicableTraits,
  CLASSIC_PLUS_CLASSIFIER_CODES,
  CLASSIC_PLUS_FORBIDDEN_TYPES,
  CLASSIC_PLUS_STEPS,
  CLASSIC_PLUS_TRAITS,
  hitLimit,
} from '../../shared/classic-plus.ts'
import type { ClassicPlusBanlist } from '../../shared/classic-plus.ts'
import type { PoolCard } from './prefilter.ts'

const here = dirname(fileURLToPath(import.meta.url))
const workDir = join(here, 'work')
const classificationsPath = join(here, 'classifications.jsonl')
const overridesPath = join(here, 'overrides.json')
const reviewPath = join(here, 'review.csv')
const banlistPath = join(here, '../../server/utils/classic-plus-banlist.json')
const handtrapsPath = join(here, '../../server/utils/classic-plus-handtraps.json')

const { values: args } = parseArgs({
  options: { 'allow-missing': { type: 'boolean', default: false } },
})

interface Hit {
  rule: string
  quote?: string
  repeatable?: boolean
  reason?: string
  /** What lifts or lowers the limit of this hit (v3.1, ADR 0045): see `hitLimit` in shared/classic-plus.ts. */
  traits?: string[]
}

interface Classification {
  id: number
  name: string
  descHash: string
  hits: Hit[]
  unsure: boolean
  note: string
}

interface Override {
  hits: Hit[]
  /** The card's final limit (0 to 3), whatever the hits say. */
  maxCopies?: 0 | 1 | 2 | 3
  note?: string
}

const stepByCode = new Map(CLASSIC_PLUS_STEPS.map(step => [step.code, step]))

/** Traits on a rule they do not belong to (e.g. `body` on rule 10): dropped, and counted for the summary. */
let ignoredTraits = 0

function readJsonl(path: string): unknown[] {
  return readFileSync(path, 'utf8').split('\n').filter(line => line.trim()).map((line, index) => {
    try {
      return JSON.parse(line)
    }
    catch {
      throw new Error(`${path}:${index + 1} is not valid JSON`)
    }
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/** Parses one classifier line; returns an error message instead when it is malformed. */
function parseResult(raw: unknown, card: PoolCard | undefined): Classification | string {
  if (!isRecord(raw) || typeof raw.id !== 'number') {
    return 'line without a numeric id'
  }
  if (!card) {
    return `card ${raw.id} is not a candidate`
  }
  if (!Array.isArray(raw.hits)) {
    return `card ${raw.id}: hits is not an array`
  }
  const hits: Hit[] = []
  for (const hit of raw.hits) {
    if (!isRecord(hit) || typeof hit.rule !== 'string' || !CLASSIC_PLUS_CLASSIFIER_CODES.includes(hit.rule)) {
      return `card ${raw.id}: unknown rule ${isRecord(hit) ? JSON.stringify(hit.rule) : '?'}`
    }
    const traits = Array.isArray(hit.traits) ? hit.traits.filter((trait): trait is string => typeof trait === 'string') : []
    const unknownTrait = traits.find(trait => !(CLASSIC_PLUS_TRAITS as readonly string[]).includes(trait))
    if (unknownTrait) {
      return `card ${raw.id}: unknown trait ${JSON.stringify(unknownTrait)}`
    }
    if (applicableTraits(hit.rule, traits).length < traits.length) {
      ignoredTraits += 1
    }
    hits.push({
      rule: hit.rule,
      quote: typeof hit.quote === 'string' ? hit.quote : '',
      repeatable: hit.repeatable === true,
      reason: typeof hit.reason === 'string' ? hit.reason : '',
      traits: applicableTraits(hit.rule, traits),
    })
  }
  return {
    id: card.id,
    name: card.name,
    descHash: card.descHash,
    hits,
    unsure: raw.unsure === true,
    note: typeof raw.note === 'string' ? raw.note : '',
  }
}

function csvCell(value: string | number | boolean): string {
  const text = String(value)
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

function main() {
  const cardsPath = join(workDir, 'cards.json')
  if (!existsSync(cardsPath)) {
    throw new Error('work/cards.json is missing — run prefilter.ts first')
  }
  const pool = JSON.parse(readFileSync(cardsPath, 'utf8')) as PoolCard[]
  const candidates = new Map(pool.filter(card => card.route === 'candidate').map(card => [card.id, card]))

  // The cache, keeping only entries whose card text is unchanged.
  const classifications = new Map<number, Classification>()
  if (existsSync(classificationsPath)) {
    for (const entry of readJsonl(classificationsPath) as Classification[]) {
      if (candidates.get(entry.id)?.descHash === entry.descHash) {
        classifications.set(entry.id, entry)
      }
    }
  }

  // Fresh results override the cache.
  const problems: string[] = []
  const resultsDir = join(workDir, 'results')
  const resultFiles = existsSync(resultsDir) ? readdirSync(resultsDir).filter(name => name.endsWith('.jsonl')).sort() : []
  for (const file of resultFiles) {
    for (const raw of readJsonl(join(resultsDir, file))) {
      const parsed = parseResult(raw, isRecord(raw) && typeof raw.id === 'number' ? candidates.get(raw.id) : undefined)
      if (typeof parsed === 'string') {
        problems.push(`${file}: ${parsed}`)
      }
      else {
        classifications.set(parsed.id, parsed)
      }
    }
  }

  const overrides = existsSync(overridesPath)
    ? JSON.parse(readFileSync(overridesPath, 'utf8')) as Record<string, Override>
    : {}
  for (const [id, override] of Object.entries(overrides)) {
    for (const hit of override.hits) {
      if (!CLASSIC_PLUS_CLASSIFIER_CODES.includes(hit.rule)) {
        throw new Error(`overrides.json: card ${id} has unknown rule ${hit.rule}`)
      }
    }
    if (override.maxCopies !== undefined && ![0, 1, 2, 3].includes(override.maxCopies)) {
      throw new Error(`overrides.json: card ${id} has maxCopies ${override.maxCopies}, expected 0 to 3`)
    }
  }

  const missing = [...candidates.values()].filter(card => !classifications.has(card.id) && !overrides[card.id])
  if (problems.length > 0) {
    console.error(`${problems.length} malformed result lines:`)
    for (const problem of problems.slice(0, 50)) {
      console.error(`  ${problem}`)
    }
  }
  if (missing.length > 0) {
    console.error(`${missing.length} candidates have no classification yet (first ids: ${missing.slice(0, 10).map(card => card.id).join(', ')})`)
    if (!args['allow-missing']) {
      console.error('Nothing written. Classify them, or pass --allow-missing for a partial run.')
      process.exit(1)
    }
  }

  // Persist the cache (sorted, one card per line, so reruns diff cleanly).
  const sortedClassifications = [...classifications.values()].sort((a, b) => a.id - b.id)
  writeFileSync(classificationsPath, sortedClassifications.map(entry => JSON.stringify(entry)).join('\n') + (sortedClassifications.length > 0 ? '\n' : ''))

  const banlist: ClassicPlusBanlist = { forbidden: [], limited: [], semiLimited: [] }
  const listFor = [banlist.forbidden, banlist.limited, banlist.semiLimited]
  const stepCounts = new Map<string, number>()
  // Cards that hit rule 4 (hand traps), for the "Classic Plus definition" of a
  // rulebook import (server/utils/handtrap-lists.ts, ADR 0037).
  const handtrapIds: number[] = []
  let rule1ByBanlist = 0
  const reviewRows: Array<{ card: PoolCard, maxCopies: number, codes: string[], hits: Hit[], unsure: boolean, quoteMissing: boolean, note: string, overridden: boolean }> = []

  for (const card of pool) {
    if (card.route === '1') {
      if (!CLASSIC_PLUS_FORBIDDEN_TYPES.includes(card.type)) {
        banlist.forbidden.push(card.id)
        rule1ByBanlist += 1
      }
      else if (overrides[card.id]?.maxCopies === 0) {
        // The type filter already forbids it; the card list names it (v3.1, K1), so it is on the banlist too.
        banlist.forbidden.push(card.id)
      }
      continue
    }
    if (card.route === '2') {
      banlist.forbidden.push(card.id)
      stepCounts.set('2', (stepCounts.get('2') ?? 0) + 1)
      continue
    }
    const override = overrides[card.id]
    // A card no pattern matched is not classified, but the card list may still name it (an override).
    // (A Normal Monster has no effect to classify, but the card list names the Exodia parts.)
    if (card.route !== 'candidate' && !((card.route === 'clear' || card.route === 'normal') && override)) {
      continue
    }
    const classification = classifications.get(card.id)
    if (!override && !classification) {
      continue
    }
    const hits = override?.hits ?? classification!.hits

    const codes = new Set(hits.map(hit => hit.rule))
    const frequency = hits.some(hit => hit.repeatable && (stepByCode.get(hit.rule)?.maxCopies ?? 0) > 0)
    if (frequency) {
      codes.add('frequency')
    }
    if (codes.has('9a') && codes.has('6b')) {
      codes.add('stacking')
    }
    for (const code of codes) {
      stepCounts.set(code, (stepCounts.get(code) ?? 0) + 1)
    }

    // Each hit has its step's limit, moved by its traits (v3.1); the two cross-cutting rules forbid outright.
    const hitLimits = hits.map(hit => hitLimit(hit.rule, stepByCode.get(hit.rule)!.maxCopies, hit.traits ?? []))
    const crossLimits = ['frequency', 'stacking'].filter(code => codes.has(code)).map(() => 0)
    const maxCopies = override?.maxCopies ?? Math.min(3, ...hitLimits, ...crossLimits)
    if (maxCopies < 3) {
      listFor[maxCopies]!.push(card.id)
    }
    if (codes.has('4')) {
      handtrapIds.push(card.id)
    }
    const unsure = !override && classification!.unsure
    const quoteMissing = !override && hits.some(hit => !hit.quote || !card.desc.includes(hit.quote))
    if (codes.size > 0 || unsure || quoteMissing || override) {
      reviewRows.push({
        card,
        maxCopies,
        codes: CLASSIC_PLUS_STEPS.map(step => step.code).filter(code => codes.has(code)),
        hits,
        unsure,
        quoteMissing,
        note: override?.note ?? classification?.note ?? '',
        overridden: Boolean(override),
      })
    }
  }

  for (const ids of listFor) {
    ids.sort((a, b) => a - b)
  }
  writeFileSync(banlistPath, `${JSON.stringify(banlist, null, 2)}\n`)
  writeFileSync(handtrapsPath, `${JSON.stringify({ ids: handtrapIds.sort((a, b) => a - b) }, null, 2)}\n`)

  reviewRows.sort((a, b) => a.maxCopies - b.maxCopies || a.card.name.localeCompare(b.card.name))
  const header = ['id', 'name', 'maxCopies', 'rules', 'unsure', 'quoteMissing', 'overridden', 'reasons', 'quotes', 'note']
  const lines = reviewRows.map(row => [
    row.card.id,
    row.card.name,
    row.maxCopies,
    row.codes.join(' '),
    row.unsure,
    row.quoteMissing,
    row.overridden,
    row.hits.map(hit => `${hit.rule}${hit.repeatable ? ' (repeatable)' : ''}${hit.traits?.length ? ` [${hit.traits.join('+')}]` : ''}: ${hit.reason ?? ''}`).join(' | '),
    row.hits.map(hit => `${hit.rule}: ${hit.quote ?? ''}`).join(' | '),
    row.note,
  ].map(csvCell).join(','))
  writeFileSync(reviewPath, `${[header.join(','), ...lines].join('\n')}\n`)

  const byCap = (cap: number) => reviewRows.filter(row => row.maxCopies === cap).length
  console.log(`Classified candidates: ${classifications.size} (+ ${Object.keys(overrides).length} overrides), missing: ${missing.length}`)
  console.log(`Banlist: forbidden ${banlist.forbidden.length}, limited ${banlist.limited.length}, semi-limited ${banlist.semiLimited.length}`)
  console.log(`  rule 1 cards the type filter misses: ${rule1ByBanlist}; rule 2: ${stepCounts.get('2') ?? 0}`)
  console.log(`  from rules 3–11: forbidden ${byCap(0)}, limited ${byCap(1)}, semi-limited ${byCap(2)}`)
  console.log(`Flagged for review: unsure ${reviewRows.filter(row => row.unsure).length}, quote not found ${reviewRows.filter(row => row.quoteMissing).length}`)
  const traitCount = (trait: string) => reviewRows.filter(row => row.hits.some(hit => hit.traits?.includes(trait))).length
  console.log(`Cards with traits (v3.1): ${CLASSIC_PLUS_TRAITS.map(trait => `${trait} ${traitCount(trait)}`).join(', ')}; traits ignored on the wrong rule: ${ignoredTraits}`)
  console.log('Cards per rule step (a card can hit several):')
  for (const step of CLASSIC_PLUS_STEPS) {
    console.log(`  ${step.code.padEnd(10)} ${String(stepCounts.get(step.code) ?? 0).padStart(5)}  (max ${step.maxCopies})  ${step.label}`)
  }
}

main()
