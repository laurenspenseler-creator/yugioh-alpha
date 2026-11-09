// Classic Plus v3.1 re-check (ADR 0045): the cards the traits (body, cost, noanswer, bound, chain) can still move, in batches for
// subagents (scripts/classic-plus/recheck-prompt.md), and the merge of what they wrote back.
//
//   node scripts/classic-plus/recheck.ts batches [--size 50]   writes work/recheck/batches/bNNN.jsonl
//   node scripts/classic-plus/recheck.ts merge [--dry]         merges work/recheck/results/bNNN.jsonl into classifications.jsonl
//
// Needs work/cards.json (prefilter.ts). A card that was re-checked has "v3.1 re-check:" in its note and is left out of the
// next `batches`, so a run that was stopped (a plan limit) can simply be continued. Afterwards run combine.ts.
//
// What `merge` does with a result: the quote of a hit that is not an exact substring of the card text is shortened to the
// longest piece that is; the final hits and traits replace the cached ones; `repeatable` (the frequency modifier, not part of
// v3.1 and reviewed by the owner) stays where the card already had that rule; a rule the re-check adds brings its own value.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import Database from 'better-sqlite3'
import { applicableTraits, CLASSIC_PLUS_CLASSIFIER_CODES, CLASSIC_PLUS_STEPS, CLASSIC_PLUS_TIERED_RULES, CLASSIC_PLUS_TRAITS, hitLimit } from '../../shared/classic-plus.ts'
import type { PoolCard } from './prefilter.ts'

const here = dirname(fileURLToPath(import.meta.url))
const workDir = join(here, 'work')
const recheckDir = join(workDir, 'recheck')
const classificationsPath = join(here, 'classifications.jsonl')
const overridesPath = join(here, 'overrides.json')
const MARK = 'v3.1 re-check:'

const { positionals, values: args } = parseArgs({
  allowPositionals: true,
  options: {
    'size': { type: 'string', default: '50' },
    'dry': { type: 'boolean', default: false },
    'db': { type: 'string', default: process.env.DB_FILE_PATH ?? './data/app.db' },
  },
})

interface Hit { rule: string, quote: string, repeatable: boolean, reason: string, traits: string[] }
interface Classification { id: number, name: string, descHash: string, hits: Hit[], unsure: boolean, note: string }

const stepLimit = new Map(CLASSIC_PLUS_STEPS.map(step => [step.code, step.maxCopies]))

function readJsonl<T>(path: string): T[] {
  return readFileSync(path, 'utf8').split('\n').filter(line => line.trim()).map(line => JSON.parse(line) as T)
}

function loadPool(): PoolCard[] {
  const path = join(workDir, 'cards.json')
  if (!existsSync(path)) {
    throw new Error('work/cards.json is missing: run prefilter.ts first')
  }
  return JSON.parse(readFileSync(path, 'utf8')) as PoolCard[]
}

function loadCache(): Map<number, Classification> {
  return new Map(readJsonl<Classification>(classificationsPath).map(entry => [entry.id, entry]))
}

function loadOverrides(): Record<string, unknown> {
  return existsSync(overridesPath) ? JSON.parse(readFileSync(overridesPath, 'utf8')) as Record<string, unknown> : {}
}

/** The quoted names in a card text that are the exact name of another card in the catalog (an archetype usually is not). */
function namedCards(card: PoolCard, names: Set<string>): string[] {
  return [...new Set([...card.desc.matchAll(/"([^"]{3,})"/g)].map(match => match[1]!).filter(name => name !== card.name && names.has(name)))]
}

/** Can the traits move this card up at all? Its limit is the strictest of its hits. */
function canRise(hits: Array<{ rule: string, repeatable: boolean }>, chain: boolean): boolean {
  if (hits.some(hit => hit.repeatable && (stepLimit.get(hit.rule) ?? 0) > 0) || (hits.some(hit => hit.rule === '9a') && hits.some(hit => hit.rule === '6b'))) {
    return false
  }
  const lifts = (rule: string) => (CLASSIC_PLUS_TIERED_RULES.includes(rule) || rule === '5') && stepLimit.get(rule) === 1
  const current = Math.min(3, ...hits.map(hit => stepLimit.get(hit.rule) ?? 3))
  const upper = Math.min(3, ...hits.map(hit => Math.min(2, (stepLimit.get(hit.rule) ?? 3) + (lifts(hit.rule) || chain ? 1 : 0))))
  return upper > current
}

function batches() {
  const size = Number(args.size)
  const pool = loadPool()
  const cache = loadCache()
  const overrides = loadOverrides()
  const db = new Database(args.db!, { readonly: true, fileMustExist: true })
  const names = new Set((db.prepare('SELECT name FROM catalog_card WHERE retired_at IS NULL').all() as Array<{ name: string }>).map(row => row.name))
  db.close()

  const todo: unknown[] = []
  let done = 0
  for (const card of pool) {
    const entry = cache.get(card.id)
    if (card.route !== 'candidate' || !entry || overrides[card.id] || entry.hits.length === 0) {
      continue
    }
    if (!canRise(entry.hits, namedCards(card, names).length > 0)) {
      continue
    }
    if (entry.note.includes(MARK)) {
      done += 1
      continue
    }
    todo.push({
      id: card.id,
      name: card.name,
      type: card.type,
      frameType: card.frameType,
      race: card.race,
      attribute: card.attribute,
      level: card.level,
      desc: card.desc,
      oldHits: entry.hits.map(hit => ({ rule: hit.rule, quote: hit.quote, repeatable: hit.repeatable })),
      oldUnsure: entry.unsure,
      namedCards: namedCards(card, names),
    })
  }
  rmSync(join(recheckDir, 'batches'), { recursive: true, force: true })
  mkdirSync(join(recheckDir, 'batches'), { recursive: true })
  mkdirSync(join(recheckDir, 'results'), { recursive: true })
  let count = 0
  for (let start = 0; start < todo.length; start += size) {
    count += 1
    writeFileSync(join(recheckDir, 'batches', `b${String(count).padStart(3, '0')}.jsonl`), `${todo.slice(start, start + size).map(card => JSON.stringify(card)).join('\n')}\n`)
  }
  console.log(`Cards the traits can move and that are not re-checked yet: ${todo.length} in ${count} batches of up to ${size} (already re-checked: ${done})`)
}

/** The longest piece of `quote` (at least 12 characters) that is an exact substring of `desc`, else ''. */
function longestPiece(desc: string, quote: string): string {
  const text = quote.replaceAll('\\"', '"')
  if (desc.includes(text)) {
    return text
  }
  let best = ''
  for (let start = 0; start < text.length; start++) {
    for (let length = Math.min(text.length - start, 200); length > Math.max(best.length, 11); length--) {
      const piece = text.slice(start, start + length)
      if (desc.includes(piece)) {
        best = piece
        break
      }
    }
  }
  return best
}

function merge() {
  const pool = new Map(loadPool().map(card => [card.id, card]))
  const cache = loadCache()
  const overrides = loadOverrides()
  const resultsDir = join(recheckDir, 'results')
  const files = existsSync(resultsDir) ? readdirSync(resultsDir).filter(name => /^b\d+\.jsonl$/.test(name)).sort() : []
  const problems: string[] = []
  let merged = 0
  let changedRules = 0
  let raised = 0
  const seen = new Set<number>()
  for (const file of files) {
    let lines: unknown[]
    try {
      lines = readJsonl<unknown>(join(resultsDir, file))
    }
    catch {
      problems.push(`${file}: not valid JSONL, run it again`)
      continue
    }
    for (const raw of lines) {
      const result = raw as { id?: number, hits?: Array<Record<string, unknown>>, unsure?: boolean, note?: string }
      const card = typeof result.id === 'number' ? pool.get(result.id) : undefined
      const old = card ? cache.get(card.id) : undefined
      if (!card || !old || !Array.isArray(result.hits) || seen.has(card.id)) {
        problems.push(`${file}: a line that is not a re-checked candidate`)
        continue
      }
      seen.add(card.id)
      if (overrides[card.id]) {
        continue
      }
      const hits: Hit[] = []
      let broken = ''
      for (const hit of result.hits) {
        const rule = String(hit.rule)
        const quote = longestPiece(card.desc, typeof hit.quote === 'string' ? hit.quote : '')
        const traits = Array.isArray(hit.traits) ? hit.traits.map(String) : []
        if (!CLASSIC_PLUS_CLASSIFIER_CODES.includes(rule)) {
          broken = `unknown rule ${rule}`
        }
        else if (traits.some(trait => !(CLASSIC_PLUS_TRAITS as readonly string[]).includes(trait))) {
          broken = `unknown trait in ${traits.join(',')}`
        }
        else if (quote.length < 12) {
          broken = `no quote of the text for rule ${rule}`
        }
        const had = old.hits.some(earlier => earlier.rule === rule)
        hits.push({
          rule,
          quote,
          repeatable: had ? old.hits.some(earlier => earlier.rule === rule && earlier.repeatable) : hit.repeatable === true,
          reason: typeof hit.reason === 'string' ? hit.reason : '',
          traits: applicableTraits(rule, traits),
        })
      }
      if (broken) {
        problems.push(`${card.name} (${card.id}): ${broken}`)
        continue
      }
      const limit = (list: Hit[]) => Math.min(3, ...list.map(hit => hitLimit(hit.rule, (stepLimit.get(hit.rule) ?? 3) as 0 | 1 | 2, hit.traits)))
      if ([...new Set(old.hits.map(hit => hit.rule))].sort().join() !== [...new Set(hits.map(hit => hit.rule))].sort().join()) {
        changedRules += 1
      }
      if (limit(hits) > limit(old.hits.map(hit => ({ ...hit, traits: [] })))) {
        raised += 1
      }
      cache.set(card.id, {
        ...old,
        hits,
        unsure: result.unsure === true,
        note: [old.note, `${MARK} ${result.note || 'tiers read from the card text.'}`].filter(Boolean).join(' '),
      })
      merged += 1
    }
  }
  console.log(`Result files: ${files.length}; cards merged: ${merged}; with other rules than before: ${changedRules}; limit raised by the traits: ${raised}`)
  for (const problem of problems) {
    console.error(`  ${problem}`)
  }
  if (!args.dry) {
    writeFileSync(classificationsPath, `${[...cache.values()].sort((a, b) => a.id - b.id).map(entry => JSON.stringify(entry)).join('\n')}\n`)
    console.log('classifications.jsonl written; run combine.ts next')
  }
}

const command = positionals[0]
if (command === 'batches') {
  batches()
}
else if (command === 'merge') {
  merge()
}
else {
  console.error('usage: node scripts/classic-plus/recheck.ts batches|merge')
  process.exit(1)
}
