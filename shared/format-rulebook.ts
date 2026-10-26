// Reads the rules of a format out of a written rulebook (the text of a PDF or a
// pasted text) and says, sentence by sentence, what the rule engine can enforce
// and what it can't, and why (ADR 0037). Pure and dependency-free like the
// engine (shared/rule-formats.ts): the server adds the catalog lookups for
// named card lists and the PDF text extraction.
//
// This is a reader for the usual German and English phrasing of house formats
// ("Main Deck: 40 bis 50 Karten", "maximal 3 Kopien pro Karte", "Synchro, Xyz,
// Link, Pendel sind verboten"), not a language model: a sentence it does not
// recognise is reported as such instead of being guessed at.
import { CLASSIC_PLUS_FORBIDDEN_TYPES } from './classic-plus'
import { MAX_COPIES_RULE, RULE_FORMAT_DESCRIPTION_MAX_LENGTH, RULE_FORMAT_NAME_MAX_LENGTH } from './rule-formats'
import type { BuiltinFormatId, CardStatusName, Rule, RuleSet } from './rule-formats'
import type { DeckSection } from './deck-sections'

export type FindingStatus =
  /** Became a rule the engine enforces. */
  | 'applied'
  /** Game flow (life points, phases, who starts …): no deck rule, kept in the description. */
  | 'description'
  /** The engine can't check it; `code` says why. */
  | 'unsupported'
  /** Several definitions fit; the user picks one on the page (hand traps). */
  | 'decision'
  /** A remark, such as "this format is built in already". */
  | 'info'

export interface Finding {
  status: FindingStatus
  /** Key under `formats.pdf.finding.<code>` in the interface language. */
  code: string
  params?: Record<string, string | number>
  /** The sentence of the rulebook the finding is about. */
  source: string
}

/** Card names a rulebook lists under a status; the server resolves them against the catalog. */
export interface CardNameList {
  status: CardStatusName
  names: string[]
  source: string
}

export interface RulebookAnalysis {
  name: string
  description: string
  rules: Rule[]
  findings: Finding[]
  cardLists: CardNameList[]
  /** The built-in format the rulebook seems to describe, if any. */
  builtinId: BuiltinFormatId | null
}

/** The largest PDF read, and the most characters of rulebook text; a rulebook is a few pages, not a book. */
export const RULEBOOK_PDF_MAX_MB = 5
export const RULEBOOK_MAX_CHARS = 60_000

/** What `POST /api/formats/analyze` answers: the analysis with card lists resolved to catalog ids. */
export interface RulebookImport {
  name: string
  description: string
  rules: RuleSet
  findings: Finding[]
  /** Names of the cards the rules reference, for the editor (English / German, ADR 0015). */
  cardNames: Record<number, string>
  cardNamesDe: Record<number, string>
  builtinId: BuiltinFormatId | null
  /** Characters of rulebook text that were read. */
  textLength: number
  source: 'pdf' | 'text'
}

// --- Text to statements -----------------------------------------------------

export interface Statement {
  text: string
  /** The heading of a numbered rule block ("FLOODGATES" for "3 — FLOODGATES"), else null. */
  context: string | null
  /** A short line without a bullet or a full stop: a section title ("Ablauf"), not a rule. */
  heading: boolean
  bullet: boolean
}

/** A wrapped PDF line is about this long; a shorter one ended on purpose. */
const WRAPPED_LINE_LENGTH = 70
const CONTINUES = /(?:[→,—–(-]|\b(?:und|oder|bzw|sowie|and|or))$/i

const PAGE_MARKER = /^=+ Seite \d+ =+$/
const BULLET = /^(?:[•·▪◦‣●○■□*]|[-–—](?=\s)|\d{1,2}\s?[.)])\s+/
const RULE_HEADING = /^\d{1,2}\s*[—–-]\s*(\S.*)$/
const SENTENCE_END = /[.!?:]$/

export function cleanLines(text: string): string[] {
  return text
    .replace(/\r/g, '')
    .split('\n')
    .map(line => line.replace(/\s+/g, ' ').trim())
    .filter(line => line !== '' && !PAGE_MARKER.test(line))
}

/** Bulleted items and wrapped lines joined back into one statement each; numbered rule headings become the context of what follows. */
export function readStatements(lines: string[]): Statement[] {
  const statements: Statement[] = []
  let context: string | null = null
  let current: Statement | null = null
  let lastLineLength = 0

  function flush() {
    if (current) {
      statements.push(current)
      current = null
    }
  }

  for (const line of lines) {
    const heading = RULE_HEADING.exec(line)
    if (heading && line.length < 80 && !/[.!?]$/.test(line)) {
      flush()
      context = heading[1]!.trim()
      lastLineLength = line.length
      continue
    }

    const bullet = BULLET.exec(line)
    if (bullet) {
      flush()
      current = { text: line.slice(bullet[0].length), context, heading: false, bullet: true }
      lastLineLength = line.length
      continue
    }

    // PDF text wraps mid-sentence: a line is the rest of the previous one when
    // that did not end a sentence and this one starts in lower case, or the
    // previous line was as long as a wrapped one and this is not a short title.
    const isShortTitle = line.split(' ').length <= 4 && !/[.!?]$/.test(line)
    const wrapped = current !== null && (
      /^[a-zäöüß(„"“]/.test(line)
      // The previous line stopped on an arrow, comma, dash or a joining word: more is coming.
      || CONTINUES.test(current.text)
      || (!SENTENCE_END.test(current.text) && lastLineLength >= WRAPPED_LINE_LENGTH && !isShortTitle)
    )
    lastLineLength = line.length
    if (wrapped) {
      current!.text += ` ${line}`
      continue
    }

    flush()
    current = { text: line, context, heading: false, bullet: false }
  }
  flush()

  return statements.map(statement => ({
    ...statement,
    heading: !statement.bullet && statement.text.split(' ').length <= 4 && !/[.!?]$/.test(statement.text),
  }))
}

/** The sentence of `text` that contains `index`, cut to a length the UI can quote. */
function sentenceAround(text: string, index: number): string {
  const before = text.slice(0, index)
  const lastEnd = Math.max(before.lastIndexOf('. '), before.lastIndexOf('! '), before.lastIndexOf('? '))
  const from = lastEnd < 0 ? 0 : lastEnd + 2
  const rest = text.slice(index)
  const endOffset = rest.search(/[.!?](?:\s|$)/)
  const to = endOffset < 0 ? text.length : index + endOffset + 1
  const sentence = text.slice(from, to).trim()
  return sentence.length > 240 ? `${sentence.slice(0, 237)}…` : sentence
}

// --- Detectors ----------------------------------------------------------------

const DECK_WORD: Record<DeckSection, string> = {
  main: '(?:main|haupt)[\\s-]*deck',
  extra: 'extra[\\s-]*deck',
  side: 'side[\\s-]*deck',
}
const NUMBER = '(\\d{1,3})'
const RANGE_SEPARATOR = '\\s*(?:bis|-|–|—|to)\\s*'
// Written as regex literals: the words are what a rulebook says, not copy (ADR 0014).
const MAXIMUM = /(?:maximal|max\.?|höchstens|bis zu|up to|maximum|at most)/.source
const MINIMUM = '(?:mindestens|min\\.?|at least)'
const FORBID = /verbot|nicht erlaubt|ausgeschlossen|banned|forbidden|\bverboten\b/i
const TEXT_MENTION = /erwähn|im\s+(?:effekt)?text|mention/i
const GAMEPLAY = /lebenspunkt|life ?points|\blp\b|\bphase\b|\bphasen\b|schere|stein,|papier|zeitlimit|time limit|best of|jeder gegen jeden|round robin|startspieler|beginnende|mischen|abheben|ersten (?:zug|spielzug)|zonen|feldzone|münzwurf|würfel/i
/** A longer paragraph is an instruction or a definition, not a line of game flow. */
const GAMEPLAY_MAX_LENGTH = 200

const SIZE_PATTERNS = (section: DeckSection) => ({
  range: new RegExp(`${DECK_WORD[section]}[^\\d.;]{0,24}${NUMBER}${RANGE_SEPARATOR}${NUMBER}`, 'i'),
  max: new RegExp(`${DECK_WORD[section]}[^\\d.;]{0,30}?${MAXIMUM}\\s*${NUMBER}`, 'i'),
  min: new RegExp(`${DECK_WORD[section]}[^\\d.;]{0,30}?${MINIMUM}\\s*${NUMBER}`, 'i'),
})
const NO_SIDE = /(?:kein(?:e|en|es)?|ohne|no)\s+side[\s-]*deck|side[\s-]*deck[^.;\d]{0,12}(?:kein|keins|keine|none|nicht erlaubt|verboten)|side[\s-]*deck\s*[:=]\s*0\b/i

const COPIES_PATTERNS = [
  new RegExp(`${MAXIMUM}\\s*(\\d{1,2})\\s*(?:kopien|exemplare|copies|mal)\\b`, 'i'),
  /(\d{1,2})\s*(?:kopien|exemplare|copies)\s*(?:pro|je|per|of each)\s*karte/i,
  /ist auf (\d{1,2}) spielbar/i,
]

const SUMMON_TYPES = {
  Synchro: CLASSIC_PLUS_FORBIDDEN_TYPES.filter(type => /^Synchro/.test(type)),
  Xyz: CLASSIC_PLUS_FORBIDDEN_TYPES.filter(type => /^XYZ/.test(type)),
  Link: CLASSIC_PLUS_FORBIDDEN_TYPES.filter(type => /^Link/.test(type)),
  Pendel: CLASSIC_PLUS_FORBIDDEN_TYPES.filter(type => /Pendulum/.test(type)),
}
/** The word the English card text uses for each of them ("Pendel" is the German name). */
const SUMMON_TEXT_TERMS: Record<keyof typeof SUMMON_TYPES, string> = {
  Synchro: 'Synchro',
  Xyz: 'Xyz',
  Link: 'Link',
  Pendel: 'Pendulum',
}
/** Every card type with "Tuner" in it: German calls Tuner monsters "Empfänger". */
const TUNER_TYPES = ['Tuner Monster', 'Normal Tuner Monster', 'Flip Tuner Effect Monster', 'Pendulum Tuner Effect Monster', 'Synchro Tuner Monster']
/** How a card says it ends the Duel ("you win the Duel", "your opponent wins the Duel"). */
const INSTANT_WIN_PHRASES = ['win the Duel', 'wins the Duel']
const SUMMON_WORDS: Array<[keyof typeof SUMMON_TYPES, RegExp]> = [
  ['Synchro', /synchro/i],
  ['Xyz', /\bxyz\b/i],
  ['Link', /\blink(?:monster)?\b/i],
  ['Pendel', /pend(?:el|ulum)/i],
]

const LIST_HEADING = /^(verbotene karten|verbotene|verboten|forbidden|banned(?: cards)?|verbotsliste|bannliste|banliste|limitierte karten|limitiert|limited|semi[- ]?limitiert(?:e karten)?|semi[- ]?limited|halb[- ]?limitiert)\s*:?$/i
const LIST_INLINE = /^(verbotene karten|verbotene|verboten|forbidden|banned(?: cards)?|limitierte karten|limitiert|limited|semi[- ]?limitiert(?:e karten)?|semi[- ]?limited)\s*:\s*(.+)$/i

function listStatus(word: string): CardStatusName {
  const lower = word.toLowerCase()
  if (/semi|halb/.test(lower)) {
    return 'semi_limited'
  }
  return /limit/.test(lower) ? 'limited' : 'forbidden'
}

function splitNames(text: string): string[] {
  const parts = /[;•]/.test(text) ? text.split(/[;•]/) : text.split(/,\s+(?=[A-ZÄÖÜ0-9])/)
  return parts
    .map(part => part.replace(/^\s*[-–—]\s*/, '').replace(/[.]+$/, '').trim())
    .filter(part => part !== '' && part.length <= 60 && part.split(' ').length <= 8)
}

const BUILTIN_BY_NAME: Array<[RegExp, BuiltinFormatId]> = [
  [/classic[\s-]*plus/i, 'classic-plus'],
  [/\bedison\b/i, 'edison'],
  [/\bgoat\b/i, 'goat'],
]

function guessName(lines: string[]): string {
  for (const line of lines.slice(0, 8)) {
    // The generic title line ("Yu-Gi-Oh! Format") names no format.
    if (/^yu-?gi-?oh!?(?:\s+trading card game)?\s*(?:format|regeln|regelwerk)?\s*$/i.test(line) || /^(?:format|regeln|regelwerk)$/i.test(line)) {
      continue
    }
    if (BULLET.test(line) || SENTENCE_END.test(line) || line.split(' ').length > 12) {
      continue
    }
    const title = line.split(/\s[—–-]\s/)[0]!.trim()
    if (title !== '') {
      return title.slice(0, RULE_FORMAT_NAME_MAX_LENGTH)
    }
  }
  return ''
}

interface Sizes {
  min?: number
  max?: number
}

/** Reads one rulebook text. `text` is the plain text of the PDF, lines as printed. */
export function analyzeRulebook(text: string): RulebookAnalysis {
  const lines = cleanLines(text)
  const statements = readStatements(lines)
  const findings: Finding[] = []
  const cardLists: CardNameList[] = []
  const sizes: Partial<Record<DeckSection, Sizes>> = {}
  const filters: Rule[] = []
  const banlists: Rule[] = []
  const gameplay: string[] = []
  let copies: number | null = null

  const add = (status: FindingStatus, code: string, source: string, params?: Record<string, string | number>) => {
    findings.push({ status, code, source, ...(params ? { params } : {}) })
  }
  const setSize = (section: DeckSection, size: Sizes) => {
    const known = sizes[section] ?? {}
    sizes[section] = { min: known.min ?? size.min, max: known.max ?? size.max }
  }
  const addFilter = (rule: Rule) => {
    if (!filters.some(existing => JSON.stringify(existing) === JSON.stringify(rule))) {
      filters.push(rule)
    }
  }

  let listContext: CardStatusName | null = null
  // A numbered rule block ("3 — FLOODGATES") nothing in it was understood as a deck rule.
  let blockContext: string | null = null
  let blockFired = true
  let blockSource = ''
  const closeBlock = () => {
    if (blockContext !== null && !blockFired) {
      add('unsupported', 'effect_class', blockSource, { topic: blockContext })
    }
  }

  for (const statement of statements) {
    if (statement.context !== blockContext) {
      closeBlock()
      blockContext = statement.context
      blockFired = false
      blockSource = statement.context === null ? '' : `${statement.context}: ${statement.text}`.slice(0, 240)
    }
    const before = findings.length
    const body = statement.text
    const full = statement.context === null ? body : `${statement.context} ${body}`

    // Named card lists: a heading ("Verbotene Karten") and the names after it, or "Verboten: A; B".
    // (Not inside a numbered rule block: there "VERBOTEN" is a verdict, not a list title.)
    if (statement.heading && statement.context === null && LIST_HEADING.test(body)) {
      listContext = listStatus(body)
      blockFired = true
      continue
    }
    if (statement.heading) {
      listContext = null
    }
    const inline = LIST_INLINE.exec(body)
    if (inline || (listContext !== null && !statement.heading)) {
      const names = splitNames(inline ? inline[2]! : body)
      const status = inline ? listStatus(inline[1]!) : listContext!
      if (names.length > 0) {
        cardLists.push({ status, names, source: body.slice(0, 240) })
        blockFired = true
        continue
      }
    }

    // Deck sizes.
    for (const section of ['main', 'extra', 'side'] as const) {
      const patterns = SIZE_PATTERNS(section)
      const range = patterns.range.exec(body)
      if (range) {
        setSize(section, { min: Number(range[1]), max: Number(range[2]) })
        add('applied', `${section}_size`, sentenceAround(body, range.index), { min: Number(range[1]), max: Number(range[2]) })
        continue
      }
      const max = patterns.max.exec(body)
      const min = patterns.min.exec(body)
      if (max || min) {
        setSize(section, { min: min ? Number(min[1]) : undefined, max: max ? Number(max[1]) : undefined })
        add('applied', `${section}_limit`, sentenceAround(body, (max ?? min)!.index), {
          ...(min ? { min: Number(min[1]) } : {}),
          ...(max ? { max: Number(max[1]) } : {}),
        })
      }
    }
    const noSide = NO_SIDE.exec(body)
    if (noSide) {
      setSize('side', { max: 0 })
      add('applied', 'no_side', sentenceAround(body, noSide.index))
    }

    // Copies per card.
    for (const pattern of COPIES_PATTERNS) {
      const match = pattern.exec(body)
      const value = match ? Number(match[1]) : 0
      if (match && value >= 1 && value <= MAX_COPIES_RULE) {
        copies ??= value
        add('applied', 'copies', sentenceAround(body, match.index), { max: value })
        break
      }
    }

    // Extra Deck only Fusion monsters.
    const fusionOnly = /(?:ausschlie(?:ß|ss)lich|nur)\s+fusions?(?:monster)?/i.exec(body)
    if (fusionOnly && /extra/i.test(body)) {
      addFilter({
        kind: 'filter',
        match: 'matching',
        filter: { types: [...SUMMON_TYPES.Synchro, ...SUMMON_TYPES.Xyz, ...SUMMON_TYPES.Link].filter(type => !/Pendulum/.test(type)) },
        maxCopies: 0,
        // The rule's name is the rulebook's own wording, so it reads in the rulebook's language.
        label: `Extra Deck: ${fusionOnly[0]}`,
      })
      add('applied', 'extra_fusion_only', sentenceAround(body, fusionOnly.index))
    }

    // Forbidden kinds of cards.
    const mentionsText = TEXT_MENTION.test(body)
    const forbids = FORBID.test(full)
    const summons = SUMMON_WORDS.filter(([, word]) => word.test(body)).map(([name]) => name)
    if (summons.length > 0 && mentionsText && forbids) {
      // "Karten, die Synchro … erwähnen, sind verboten": a rule on the card text (ADR 0038).
      addFilter({
        kind: 'filter',
        match: 'matching',
        filter: { textContains: summons.map(name => SUMMON_TEXT_TERMS[name]) },
        maxCopies: 0,
        label: `${summons.join(', ')} (Text)`,
      })
      add('applied', 'text_mention', sentenceAround(body, body.search(SUMMON_WORDS.find(([name]) => name === summons[0])![1])), { terms: summons.join(', ') })
    }
    else if (summons.length > 0 && forbids && !mentionsText) {
      const types = [...new Set(summons.flatMap(name => SUMMON_TYPES[name]))]
      addFilter({ kind: 'filter', match: 'matching', filter: { types }, maxCopies: 0, label: summons.join(', ') })
      add('applied', 'modern_summons', sentenceAround(body, body.search(SUMMON_WORDS.find(([name]) => name === summons[0])![1])), { terms: summons.join(', ') })
    }

    const gemini = /zwillings|gemini/i.exec(body)
    if (gemini && forbids) {
      addFilter({ kind: 'filter', match: 'matching', filter: { types: ['Gemini Monster'] }, maxCopies: 0, label: 'Gemini' })
      add('applied', 'gemini', sentenceAround(body, gemini.index))
    }

    // "Karten mit Effekten sind … auf 1x limitiert" / "cards with effects are limited to 1".
    const withEffect = /karten?\s+mit\s+effekt(?:en)?|cards?\s+with\s+(?:an\s+)?effects?/i.exec(body)
    if (withEffect) {
      const sentence = sentenceAround(body, withEffect.index)
      const limit = /(\d)\s*x/i.exec(sentence) ?? /(?:limitiert|begrenzt|beschränkt|limited|restricted)\s+(?:auf|to)\s+(\d)/i.exec(sentence) ?? /\b(?:auf|to)\s+(\d)\b/i.exec(sentence)
      if (limit && /limit|begrenz|beschränk|max/i.test(sentence) && Number(limit[1]) <= 3) {
        addFilter({ kind: 'filter', match: 'matching', filter: { hasEffect: true }, maxCopies: Number(limit[1]) as 0 | 1 | 2 | 3, label: withEffect[0] })
        add('applied', 'effects_limited', sentence, { max: Number(limit[1]) })
      }
    }

    // A banlist the format uses.
    if (/banlist|bannliste|verbotsliste|ban list|forbidden\s*(?:&|and|und)\s*limited|forbidden\/limited/i.test(body) && !/irrelevant|ignorier|nicht\b/i.test(body)) {
      const source = /classic[\s-]*plus/i.test(body)
        ? 'classic-plus' as const
        : /\bgoat\b/i.test(body) ? 'goat' as const : /\bedison\b/i.test(body) ? 'edison' as const : /\bocg\b/i.test(body) ? 'ocg' as const : /\btcg\b/i.test(body) ? 'tcg' as const : null
      if (source) {
        if (!banlists.some(rule => rule.kind === 'banlist' && rule.source === source)) {
          banlists.push({ kind: 'banlist', source })
        }
        add('applied', 'banlist', sentenceAround(body, 0), { source })
      }
      else {
        add('unsupported', 'banlist_unknown', sentenceAround(body, 0))
      }
    }

    // A card class is only a restriction when the sentence forbids it: "Die
    // Begriffe Handtrap … nur so verwenden" defines words.
    const exceptionAfter = (index: number) => /(?:außer|except)\s+([^),.;]+)/i.exec(body.slice(index))?.[1]?.trim()

    // Hand traps are defined by what the card does, so the user picks a
    // definition (Classic Plus's, a stricter one, their own) after the reading.
    const handtrap = forbids ? /hand[\s-]*trap/i.exec(body) : null
    if (handtrap) {
      const except = exceptionAfter(handtrap.index)
      add('decision', 'handtrap', sentenceAround(body, handtrap.index), except ? { except } : undefined)
    }
    // "Instant Win": the card text says who wins the Duel (ADR 0038).
    const instantWin = forbids ? /instant[\s-]*win|sofort(?:iger)?\s+(?:sieg|gewinn)/i.exec(body) : null
    if (instantWin) {
      const except = exceptionAfter(instantWin.index)
      addFilter({
        kind: 'filter',
        match: 'matching',
        filter: { textContains: INSTANT_WIN_PHRASES },
        maxCopies: 0,
        label: 'Instant Win',
        ...(except ? { except: { nameContains: except } } : {}),
      })
      add('applied', 'instant_win', sentenceAround(body, instantWin.index), except ? { except } : undefined)
    }
    // "Empfänger" is the German word for Tuner.
    const receiver = forbids ? /\b[\p{L}-]*(?:empfänger|tuner)[\p{L}-]*/iu.exec(body) : null
    if (receiver) {
      addFilter({ kind: 'filter', match: 'matching', filter: { types: TUNER_TYPES }, maxCopies: 0, label: receiver[0] })
      add('applied', 'receiver', sentenceAround(body, receiver.index))
    }
    const sleeves = /hülle|sleeve/i.exec(body)
    if (sleeves) {
      add('unsupported', 'sleeves', sentenceAround(body, sleeves.index))
    }

    if (findings.length > before) {
      blockFired = true
      continue
    }

    // Nothing recognised: game flow, a heading, or something we don't understand.
    // Judged sentence by sentence, so a paragraph with one line of game flow
    // doesn't put the whole paragraph into the description.
    if (statement.heading || statement.context !== null) {
      continue
    }
    for (const sentence of body.split(/(?<=[.!?])\s+(?=[A-ZÄÖÜ„"(])/)) {
      if (GAMEPLAY.test(sentence) && sentence.length <= GAMEPLAY_MAX_LENGTH) {
        gameplay.push(sentence)
        add('description', 'gameplay', sentence)
      }
      else if (sentence.split(' ').length >= 6) {
        add('unsupported', 'not_understood', sentence.slice(0, 240))
      }
    }
  }
  closeBlock()

  const name = guessName(lines)
  const builtinId = BUILTIN_BY_NAME.find(([pattern]) => pattern.test(name))?.[1] ?? null
  if (builtinId) {
    add('info', 'builtin_exists', name, { name })
  }

  const rules: Rule[] = []
  for (const section of ['main', 'extra', 'side'] as const) {
    const size = sizes[section]
    if (size && (size.min !== undefined || size.max !== undefined)) {
      rules.push({
        kind: 'deck_size',
        section,
        ...(size.min !== undefined ? { min: size.min } : {}),
        ...(size.max !== undefined ? { max: size.max } : {}),
      })
    }
  }
  if (copies !== null) {
    rules.push({ kind: 'copies', maxCopies: copies })
  }
  rules.push(...filters, ...banlists)

  return {
    name,
    description: gameplay.join(' · ').slice(0, RULE_FORMAT_DESCRIPTION_MAX_LENGTH),
    rules,
    findings,
    cardLists,
    builtinId,
  }
}
