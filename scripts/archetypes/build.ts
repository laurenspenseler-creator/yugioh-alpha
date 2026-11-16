// Builds the data behind the "Deckthema" (archetype) filter from Yugipedia (tester feedback, round 16: "Die Deckthemen passen
// immer noch nicht"). Run in the repo root with Node 24: `node scripts/archetypes/build.ts` (about 5 minutes).
//
// Why: the catalog (YGOPRODeck) has ONE archetype per card; the game has several per card (sub-archetypes, families such as
// "Magna Warrior" / "Magnet Warrior"), and a card does not have to carry the archetype's name. Yugipedia (a semantic wiki)
// has the full list per card (property `Archseries`, name-derived members included) and the official German name of every
// archetype (property `German name` of the archetype's page). Yugipedia's text is CC BY-SA 3.0; what is taken is facts (which
// card is in which archetype, an archetype's German name); the source is named in ADR 0049 and in the README.
//
// Writes:
//   server/data/archetype-members.json   { "<archetype>": [passcode, ...] }   (sorted)
//   shared/data/archetype-names-de.json  { "<archetype>": "<German name>" }   (only where the wiki has one)
// Low volume on purpose: about 60 requests for the cards and about 40 for the names, one after another with a pause.

import { mkdirSync, writeFileSync } from 'node:fs'

const API = 'https://yugipedia.com/api.php'
const HEADERS = { 'User-Agent': 'ygo-alpha-archetype-data/1.0 (hobby app, one-off data build, about 100 requests)' }
const PAGE = 500
const PAUSE_MS = 400

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

interface AskResult {
  query?: { results?: Record<string, { printouts: Record<string, unknown[]> }> }
  'query-continue-offset'?: number
}

async function ask(query: string): Promise<AskResult> {
  const url = `${API}?action=ask&format=json&query=${encodeURIComponent(query)}`
  for (let attempt = 1; ; attempt += 1) {
    try {
      const response = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(90_000) })
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }
      const body = await response.json() as AskResult
      await sleep(PAUSE_MS)
      return body
    }
    catch (error) {
      if (attempt >= 5) {
        throw error
      }
      console.warn(`retry ${attempt} after`, (error as Error).message)
      await sleep(2000 * attempt)
    }
  }
}

const textOf = (value: unknown): string => typeof value === 'string' ? value : (value as { fulltext?: string })?.fulltext ?? ''
const resultsOf = (page: AskResult) => Object.entries(page.query?.results ?? {})

// The wiki's page titles carry a disambiguation: "Dark Magician (archetype)", "Sacred Beast (series)". The name of the archetype is
// the title without it; an archetype of the anime only is no archetype of the game.
const DISAMBIGUATION = /\s\((?:Spell\/Trap )?(?:archetype|series)\)$/
const ANIME_ONLY = /\s\(anime\)$/
const canonical = (title: string) => title.replace(DISAMBIGUATION, '')

// 1) every card with its archetypes. The wiki's query result is capped at about 5,000 rows, so the cards are asked for by the
// first character of the page name (the biggest part, "S", has about 1,000 cards).
const members = new Map<string, Set<number>>()
let cards = 0
const PARTS = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', '"', '@', '\'', '-', '.', '#']
for (const part of PARTS) {
  for (let offset = 0; ; ) {
    const page = await ask(`[[Archseries::+]] [[Password::+]] [[~${part}*]]|?Archseries|?Password|limit=${PAGE}|offset=${offset}`)
    for (const [, entry] of resultsOf(page)) {
      const passcodes = (entry.printouts.Password ?? []).map(value => Number(textOf(value))).filter(id => Number.isInteger(id) && id > 0)
      if (passcodes.length === 0) {
        continue // a page of Duel Links / Speed Duel ... without a passcode
      }
      cards += 1
      for (const archetype of (entry.printouts.Archseries ?? []).map(textOf).filter(Boolean)) {
        const set = members.get(archetype) ?? new Set<number>()
        for (const id of passcodes) {
          set.add(id)
        }
        members.set(archetype, set)
      }
    }
    if (page['query-continue-offset'] === undefined || resultsOf(page).length === 0) {
      break
    }
    offset = page['query-continue-offset']
  }
  console.log(`part "${part}": ${cards} cards so far, ${members.size} archetypes`)
}

// 2) the German names of the archetypes (the property `German name` of the archetype's own page). A query may have about 16
// conditions: the category pages of the archetypes and series are asked for whole (a few hundred pages in one query), the rest
// in small batches.
const german = new Map<string, string>()
const titles = [...members.keys()].sort()
const wanted = new Set(titles)

function collect(page: AskResult): void {
  for (const [title, entry] of resultsOf(page)) {
    const de = textOf((entry.printouts['German name'] ?? [])[0])
    if (de && wanted.has(title)) {
      german.set(title, de)
    }
  }
}

for (const category of ['TCG and OCG archetypes', 'TCG and OCG series', 'OCG archetypes', 'OCG series', 'TCG archetypes', 'TCG series']) {
  for (let offset = 0; ; ) {
    const page = await ask(`[[Category:${category}]]|?German name|limit=${PAGE}|offset=${offset}`)
    collect(page)
    if (page['query-continue-offset'] === undefined || resultsOf(page).length === 0) {
      break
    }
    offset = page['query-continue-offset']
  }
  console.log(`category ${category}: ${german.size} German names so far`)
}

// What the categories did not name: the other archetypes, ten at a time (a title with characters that mean something in a
// query is left out: it has no German name here).
const rest = titles.filter(title => !german.has(title) && !/[[\]|{}<>#]/.test(title))
const BATCH = 10
for (let i = 0; i < rest.length; i += BATCH) {
  const batch = rest.slice(i, i + BATCH)
  collect(await ask(`${batch.map(title => `[[${title}]]`).join(' OR ')}|?German name|limit=${batch.length}`))
}
console.log(`the rest: ${german.size} German names, ${rest.length} archetypes asked for`)

// 3) the names the app shows and filters by: without the disambiguation, the archetypes that came out twice ("Sacred Beast" and
// "Sacred Beast (archetype)") as one, the anime's own left out.
const finalMembers: Record<string, number[]> = {}
const finalGerman: Record<string, string> = {}
for (const title of titles) {
  if (ANIME_ONLY.test(title)) {
    continue
  }
  const name = canonical(title)
  finalMembers[name] = [...new Set([...(finalMembers[name] ?? []), ...members.get(title)!])].sort((a, b) => a - b)
  const de = german.get(title)
  // The page of the plain name is the better source of the German name when both exist.
  if (de && (finalGerman[name] === undefined || title === name)) {
    finalGerman[name] = de
  }
}
const sortedNames = Object.keys(finalMembers).sort()
const sortedMembers: Record<string, number[]> = {}
const sortedGerman: Record<string, string> = {}
for (const name of sortedNames) {
  sortedMembers[name] = finalMembers[name]!
  if (finalGerman[name]) {
    sortedGerman[name] = finalGerman[name]
  }
}

mkdirSync('server/data', { recursive: true })
mkdirSync('shared/data', { recursive: true })
writeFileSync('server/data/archetype-members.json', `${JSON.stringify(sortedMembers)}\n`)
writeFileSync('shared/data/archetype-names-de.json', `${JSON.stringify(sortedGerman, null, 1)}\n`)
console.log(`done: ${cards} cards, ${sortedNames.length} archetypes, ${Object.keys(sortedGerman).length} German names`)
