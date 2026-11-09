// Classic Plus: the cards a human should look at (the classifier was unsure, or the re-check changed their rules), as a table
// for the rule authors: German name and card text, the limit the app gives the card now, the rules and traits behind it, the
// question or reason, and an empty column for their decision.
//
//   node scripts/classic-plus/review-export.ts [--db path/to/app.db] [--out docs/classic-plus-unsichere-karten.csv]
//
// The file is a CSV with a byte order mark and ";" as the separator, so a German Excel opens it directly. Cards with a fixed
// limit from the rule authors' own card list (overrides.json) are not in it.

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import Database from 'better-sqlite3'
import type { ClassicPlusBanlist } from '../../shared/classic-plus.ts'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '../..')

const { values: args } = parseArgs({
  options: {
    db: { type: 'string', default: process.env.DB_FILE_PATH ?? './data/app.db' },
    out: { type: 'string', default: join(repoRoot, 'docs/classic-plus-unsichere-karten.csv') },
  },
})

interface Hit { rule: string, quote?: string, repeatable?: boolean, traits?: string[] }
interface Classification { id: number, name: string, hits: Hit[], unsure: boolean, note: string }

const RULE_LABEL: Record<string, string> = {
  '3.1': 'Floodgate (Vergleich der Felder)',
  '3.2': 'Floodgate (Gegner kann sie loswerden)',
  '3.3': 'Floodgate (Kartenmerkmal)',
  '3.4': 'Floodgate',
  '4': 'Handtrap',
  '5': 'Ziehen',
  '6a': 'Effektschaden',
  '6b': 'Kampfschaden vervielfachen',
  '7a': 'Kontrolle übernehmen',
  '7b': 'Wiederbeleben',
  '7c': 'Extra-Deck-Beschwörung ohne Material',
  '7d': 'Fusionsmaterial aus dem Deck',
  '8': 'Massenremoval',
  '9a': 'Schutz vor Karteneffekten',
  '9b': 'Schutz vor Kampf',
  '10': 'Annullieren',
  '11a': 'Phase nehmen (einmalig)',
  '11b': 'Phase nehmen (wiederholt)',
}
const TRAIT_LABEL: Record<string, string> = {
  body: 'Körper',
  cost: 'Kosten',
  noanswer: 'keine echte Antwort',
  bound: 'gebundene Kosten',
  chain: 'Kette',
}
const LIMIT_LABEL = ['verboten', '1', '2', 'unbeschränkt']

const classifications = readFileSync(join(here, 'classifications.jsonl'), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line) as Classification)
const overrides = JSON.parse(readFileSync(join(here, 'overrides.json'), 'utf8')) as Record<string, unknown>
const banlist = JSON.parse(readFileSync(join(repoRoot, 'server/utils/classic-plus-banlist.json'), 'utf8')) as ClassicPlusBanlist
const limitOf = (id: number) => banlist.forbidden.includes(id) ? 0 : banlist.limited.includes(id) ? 1 : banlist.semiLimited.includes(id) ? 2 : 3

const db = new Database(args.db!, { readonly: true, fileMustExist: true })
const cardQuery = db.prepare(`
  SELECT c.name AS en, c.type, c.desc AS descEn, t.name AS de, t.desc AS descDe
  FROM catalog_card c
  LEFT JOIN catalog_card_translation t ON t.card_id = c.id AND t.locale = 'de'
  WHERE c.id = ?`)

function csvCell(value: string | number): string {
  return `"${String(value).replaceAll('"', '""')}"`
}

/** What the last re-check said, else the whole note without its boilerplate. */
function question(note: string): string {
  const marker = 'v3.1 re-check:'
  const text = note.includes(marker) ? note.slice(note.lastIndexOf(marker) + marker.length) : note
  return text.replace(/^\s*CHANGED:\s*/, '').trim()
}

const rows = classifications
  .filter(entry => !overrides[entry.id] && (entry.unsure || /CHANGED:/.test(entry.note)))
  .map((entry) => {
    const card = cardQuery.get(entry.id) as { en: string, type: string, descEn: string, de: string | null, descDe: string | null } | undefined
    const limit = limitOf(entry.id)
    const rules = entry.hits.map((hit) => {
      const traits = (hit.traits ?? []).map(trait => TRAIT_LABEL[trait] ?? trait)
      const flags = [...traits, ...(hit.repeatable ? ['wiederholbar'] : [])]
      return `${hit.rule} ${RULE_LABEL[hit.rule] ?? ''}${flags.length ? ` [${flags.join(', ')}]` : ''}`.trim()
    })
    return {
      limit,
      firstRule: entry.hits[0]?.rule ?? '~',
      name: card?.de ?? entry.name,
      cells: [
        card?.de ?? entry.name,
        card?.en ?? entry.name,
        card?.type ?? '',
        LIMIT_LABEL[limit]!,
        rules.join(' + ') || 'keine Regel',
        /CHANGED:/.test(entry.note) ? 'ja' : '',
        question(entry.note),
        entry.hits.map(hit => hit.quote).filter(Boolean).join(' | '),
        ((card?.descDe ?? card?.descEn) ?? '').replace(/\r?\n/g, ' / '),
        '',
      ],
    }
  })
  .sort((a, b) => a.limit - b.limit || a.firstRule.localeCompare(b.firstRule, 'en', { numeric: true }) || a.name.localeCompare(b.name, 'de'))

const header = ['Karte', 'Englischer Name', 'Kartenart', 'Limit jetzt', 'Regeln und Eigenschaften', 'Regel geändert', 'Frage oder Begründung (englisch)', 'Zitat aus dem englischen Kartentext', 'Kartentext', 'Entscheidung der Regelmacher']
const text = [header, ...rows.map(row => row.cells)].map(cells => cells.map(csvCell).join(';')).join('\r\n')
// The byte order mark tells Excel the file is UTF-8 (written as a character code: an invisible character in the source is a lint error).
const byteOrderMark = String.fromCharCode(0xFEFF)
writeFileSync(args.out!, `${byteOrderMark}${text}\r\n`, 'utf8')

const byLimit = [0, 1, 2, 3].map(limit => `${LIMIT_LABEL[limit]}: ${rows.filter(row => row.limit === limit).length}`).join(', ')
console.log(`${rows.length} cards written to ${args.out} (${byLimit}); changed rules: ${rows.filter(row => row.cells[5] === 'ja').length}`)
