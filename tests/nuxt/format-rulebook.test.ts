// @vitest-environment node
// Format from a written rulebook (ADR 0037): the reader against two real
// rulebooks (the text of their PDFs, tests/nuxt/fixtures/rulebooks), against
// small snippets in German and English, and the part that needs the catalog.
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import * as schema from '../../server/db/schema'
import { importRulebook } from '../../server/utils/format-import'
import { extractPdfText } from '../../server/utils/pdf-text'
import { CLASSIC_PLUS_FORBIDDEN_TYPES } from '../../shared/classic-plus'
import { analyzeRulebook } from '../../shared/format-rulebook'
import type { Finding } from '../../shared/format-rulebook'
import { seedGermanNames } from './fixtures/german-names'

const fixture = (name: string) => readFileSync(`tests/nuxt/fixtures/rulebooks/${name}`, 'utf8')
const codes = (findings: Finding[], status?: string) => findings.filter(finding => !status || finding.status === status).map(finding => finding.code)

const SYNCHRO = CLASSIC_PLUS_FORBIDDEN_TYPES.filter(type => /^Synchro/.test(type))
const XYZ = CLASSIC_PLUS_FORBIDDEN_TYPES.filter(type => /^XYZ/.test(type))
const LINK = CLASSIC_PLUS_FORBIDDEN_TYPES.filter(type => /^Link/.test(type))

describe('analyzeRulebook: Origin Legacy (a friend\'s format)', () => {
  const result = analyzeRulebook(fixture('origin-legacy.txt'))

  it('reads the name and the deck rules', () => {
    expect(result.name).toBe('Origin Legacy')
    expect(result.builtinId).toBeNull()
    expect(result.rules).toContainEqual({ kind: 'deck_size', section: 'main', min: 40, max: 50 })
    expect(result.rules).toContainEqual({ kind: 'deck_size', section: 'extra', max: 10 })
    expect(result.rules).toContainEqual({ kind: 'copies', maxCopies: 3 })
    expect(result.rules.some(rule => rule.kind === 'deck_size' && rule.section === 'side')).toBe(false)
  })

  it('turns the forbidden kinds of cards into type filters, and the effect limit into a "has effect" filter', () => {
    const filters = result.rules.filter(rule => rule.kind === 'filter')
    const forTypes = (type: string) => filters.find(rule => rule.filter.types?.includes(type))

    // Synchro, Xyz, Link and Pendulum monsters, and Gemini ("Zwillingsmonster").
    for (const type of [...SYNCHRO, ...XYZ, ...LINK, 'Pendulum Effect Monster', 'Pendulum Normal Monster']) {
      expect(forTypes(type), type).toMatchObject({ match: 'matching', maxCopies: 0 })
    }
    expect(forTypes('Gemini Monster')).toMatchObject({ maxCopies: 0 })
    // "Karten mit Effekten … grundsätzlich auf 1x limitiert", whatever the card type.
    expect(filters).toContainEqual({ kind: 'filter', match: 'matching', filter: { hasEffect: true }, maxCopies: 1, label: 'Karten mit Effekten' })
    // The Extra Deck is Fusion only: no Synchro, Xyz or Link there. The rule is named in the rulebook's words.
    expect(filters.some(rule => rule.label === 'Extra Deck: ausschließlich Fusionsmonster')).toBe(true)
  })

  it('turns "Empfängermonster" into the Tuner types, and "Instant Win" into a card-text rule with its exception', () => {
    const filters = result.rules.filter(rule => rule.kind === 'filter')

    // "Empfänger" is the German word for Tuner.
    expect(filters).toContainEqual({
      kind: 'filter',
      match: 'matching',
      filter: { types: ['Tuner Monster', 'Normal Tuner Monster', 'Flip Tuner Effect Monster', 'Pendulum Tuner Effect Monster', 'Synchro Tuner Monster'] },
      maxCopies: 0,
      label: 'Empfängermonster',
    })
    // "Karten, die einen Instant Win verursachen … (außer Exodia)": the card text says who wins the Duel.
    expect(filters).toContainEqual({
      kind: 'filter',
      match: 'matching',
      filter: { textContains: ['win the Duel', 'wins the Duel'] },
      maxCopies: 0,
      label: 'Instant Win',
      except: { nameContains: 'Exodia' },
    })
    expect(result.findings.find(finding => finding.code === 'instant_win')).toMatchObject({ status: 'applied', params: { except: 'Exodia' } })
    expect(result.findings.find(finding => finding.code === 'receiver')?.status).toBe('applied')
  })

  it('turns "Karten, die Synchro, Xyz, Link, Pendel erwähnen" into a rule on the English card text', () => {
    const filters = result.rules.filter(rule => rule.kind === 'filter')

    expect(filters).toContainEqual({
      kind: 'filter',
      match: 'matching',
      filter: { textContains: ['Synchro', 'Xyz', 'Link', 'Pendulum'] },
      maxCopies: 0,
      label: 'Synchro, Xyz, Link, Pendel (Text)',
    })
    expect(result.findings.find(finding => finding.code === 'text_mention')).toMatchObject({ status: 'applied', params: { terms: 'Synchro, Xyz, Link, Pendel' } })
  })

  it('leaves hand traps to the user, with the exception of the rulebook, and says only the sleeves can not be checked', () => {
    // No rule yet: which cards are hand traps is chosen on the page (ADR 0038).
    expect(result.findings.find(finding => finding.code === 'handtrap')).toMatchObject({ status: 'decision', params: { except: 'Kuriboh' } })
    expect(result.rules.some(rule => rule.kind === 'card_status')).toBe(false)

    const unsupported = result.findings.filter(finding => finding.status === 'unsupported')
    expect(unsupported.map(finding => finding.code)).toEqual(['sleeves'])
    expect(unsupported[0]?.source).toContain('Hüllen')
  })

  it('keeps the game flow as a description, short lines included', () => {
    expect(codes(result.findings, 'description').every(code => code === 'gameplay')).toBe(true)
    for (const text of ['8000 Lebenspunkte', 'Kein Zeitlimit', 'Schere, Stein, Papier', 'Startspieler zieht im ersten Zug nicht', 'Best of 3']) {
      expect(result.description).toContain(text)
    }
    // A section title that follows a long bullet doesn't stick to it.
    expect(result.description).not.toContain('Einschränkungen und Ausschlüsse')
    expect(result.findings.find(finding => finding.code === 'sleeves')?.source).not.toContain('Ablauf')
  })
})

describe('analyzeRulebook: Classic Plus (the rules for the card run)', () => {
  const result = analyzeRulebook(fixture('classic-plus-alpha.txt'))

  it('reads the deck rules and rule 1 (the modern summons), and knows the format is built in', () => {
    expect(result.name).toBe('Classic Plus')
    expect(result.builtinId).toBe('classic-plus')
    expect(result.rules.filter(rule => rule.kind !== 'filter')).toEqual([
      { kind: 'deck_size', section: 'main', min: 40, max: 50 },
      { kind: 'deck_size', section: 'extra', max: 10 },
      { kind: 'deck_size', section: 'side', max: 0 },
      { kind: 'copies', maxCopies: 3 },
    ])
    const summons = result.rules.find(rule => rule.kind === 'filter')
    expect(summons).toMatchObject({ match: 'matching', maxCopies: 0, label: 'Synchro, Xyz, Link, Pendel' })
    expect(codes(result.findings, 'info')).toEqual(['builtin_exists'])
  })

  it('reads rule 2 (card text) as a rule, and reports rules 3 to 11 (what a card does) as not checkable', () => {
    const unsupported = result.findings.filter(finding => finding.status === 'unsupported')

    expect(result.findings.filter(finding => finding.code === 'text_mention' && finding.status === 'applied')).toHaveLength(1)
    expect(result.rules).toContainEqual(expect.objectContaining({ kind: 'filter', filter: { textContains: ['Synchro', 'Xyz', 'Link', 'Pendulum'] } }))
    expect(unsupported.filter(finding => finding.code === 'effect_class').map(finding => finding.params?.topic)).toEqual([
      'FLOODGATES',
      'HANDTRAPS',
      'LIMIT 1',
      'SCHADEN, LIMIT 1',
      'PREISUMGEHUNG, LIMIT 1',
      'MASSENREMOVAL, LIMIT 1',
      'SCHUTZ',
      'LIMIT 1',
      'RESSOURCENVERWEIGERUNG',
    ])
    // A sentence that merely defines words ("… Handtrap … nur so verwenden") is no restriction.
    expect(codes(unsupported)).not.toContain('handtrap')
  })

  it('keeps only lines of game flow in the description, not instructions or definitions', () => {
    expect(result.description).toContain('Brett und Zonen nach Stand 2005')
    expect(result.description).toContain('Der Startspieler zieht in seinem ersten Spielzug nicht')
    expect(result.description).not.toContain('Gedächtnis')
    expect(result.description).not.toContain('Häufigkeitsmodifikator')
  })
})

describe('analyzeRulebook: other phrasings', () => {
  it('reads an English rulebook', () => {
    const result = analyzeRulebook([
      'Dino Format',
      '• Main deck: 40 to 60 cards',
      '• Extra deck: at most 15 cards',
      '• Side deck: none',
      '• Max 3 copies per card',
      '• Synchro, Xyz and Link monsters are forbidden.',
      '• Cards that mention Pendulum in their text are banned.',
    ].join('\n'))

    expect(result.name).toBe('Dino Format')
    expect(result.rules).toContainEqual({ kind: 'deck_size', section: 'main', min: 40, max: 60 })
    expect(result.rules).toContainEqual({ kind: 'deck_size', section: 'extra', max: 15 })
    expect(result.rules).toContainEqual({ kind: 'deck_size', section: 'side', max: 0 })
    expect(result.rules).toContainEqual({ kind: 'copies', maxCopies: 3 })
    expect(result.rules.some(rule => rule.kind === 'filter' && rule.filter.types?.includes('Synchro Monster'))).toBe(true)
    // Only Synchro, Xyz and Link were forbidden as monsters; the text mention of Pendulum is a different thing.
    expect(result.rules.some(rule => rule.kind === 'filter' && rule.filter.types?.includes('Pendulum Effect Monster'))).toBe(false)
    expect(result.findings.find(finding => finding.code === 'text_mention')?.params).toEqual({ terms: 'Pendel' })
  })

  it('uses the banlist a rulebook names, and says when it names none', () => {
    expect(analyzeRulebook('• Es gilt die Edison Banlist.').rules).toEqual([{ kind: 'banlist', source: 'edison' }])
    expect(analyzeRulebook('• Es gilt die GOAT Verbotsliste.').rules).toEqual([{ kind: 'banlist', source: 'goat' }])

    const unknown = analyzeRulebook('• Es gilt eine Banlist, die wir vorher ansagen.')
    expect(unknown.rules).toEqual([])
    expect(codes(unknown.findings, 'unsupported')).toEqual(['banlist_unknown'])
    // "irrelevant" is not a choice of list.
    expect(analyzeRulebook('Konamis Verbots- und Limitierungsliste ist irrelevant.').rules).toEqual([])
  })

  it('collects named card lists: under a heading, or inline', () => {
    const result = analyzeRulebook([
      'Verbotene Karten:',
      '• Pot of Greed',
      '• Raigeki',
      'Limitiert: Kuriboh; Sangan',
      'Semi-Limitiert: Jinzo',
    ].join('\n'))

    expect(result.cardLists).toEqual([
      { status: 'forbidden', names: ['Pot of Greed'], source: 'Pot of Greed' },
      { status: 'forbidden', names: ['Raigeki'], source: 'Raigeki' },
      { status: 'limited', names: ['Kuriboh', 'Sangan'], source: 'Limitiert: Kuriboh; Sangan' },
      { status: 'semi_limited', names: ['Jinzo'], source: 'Semi-Limitiert: Jinzo' },
    ])
  })

  it('limits cards with an effect to the number named, and only a number from 0 to 3', () => {
    expect(analyzeRulebook('• Karten mit Effekten sind auf 2x limitiert.').rules).toEqual([
      { kind: 'filter', match: 'matching', filter: { hasEffect: true }, maxCopies: 2, label: 'Karten mit Effekten' },
    ])
    expect(analyzeRulebook('• Cards with effects are limited to 1 copy.').rules).toEqual([
      { kind: 'filter', match: 'matching', filter: { hasEffect: true }, maxCopies: 1, label: 'Cards with effects' },
    ])
    expect(analyzeRulebook('• Karten mit Effekten sind auf 7x limitiert.').rules).toEqual([])
  })

  it('does not guess: an unrecognised sentence is reported, a title or a short line is not', () => {
    const result = analyzeRulebook('Mein Format\n• Wer verliert, räumt die Karten der anderen Spieler vollständig auf.\n• Spaß')

    expect(result.rules).toEqual([])
    expect(codes(result.findings)).toEqual(['not_understood'])
  })

  it('reads nothing from an empty text', () => {
    expect(analyzeRulebook('  \n ')).toMatchObject({ name: '', rules: [], findings: [], cardLists: [] })
  })
})

describe('importRulebook', () => {
  function createTestDb() {
    const db = drizzle(new Database(':memory:'), { schema })
    migrate(db, { migrationsFolder: './server/db/migrations' })
    const now = new Date()
    db.insert(schema.catalogCard).values([
      { id: 55144522, name: 'Pot of Greed', type: 'Spell Card', frameType: 'spell', desc: '', syncedAt: now },
      { id: 12580477, name: 'Raigeki', type: 'Spell Card', frameType: 'spell', desc: '', syncedAt: now },
      { id: 40640057, name: 'Kuriboh', type: 'Effect Monster', frameType: 'effect', desc: '', syncedAt: now },
    ]).run()
    seedGermanNames(db, { 55144522: 'Topf der Gier', 12580477: 'Raigeki', 40640057: 'Kuriboh' })
    return db
  }

  it('resolves card lists by English or German name and says which names it did not find', () => {
    const db = createTestDb()

    const result = importRulebook(db, [
      'Verbotene Karten:',
      '• Topf der Gier',
      '• Raigeki',
      '• Zauberkarte, die es nicht gibt',
      'Limitiert: Kuriboh',
    ].join('\n'))

    expect(result.rules.rules).toEqual([
      { kind: 'card_status', status: 'forbidden', cardIds: [55144522] },
      { kind: 'card_status', status: 'forbidden', cardIds: [12580477] },
      { kind: 'card_status', status: 'limited', cardIds: [40640057] },
    ])
    expect(result.findings.filter(finding => finding.code === 'card_list').map(finding => finding.params)).toEqual([
      { status: 'forbidden', found: 1, total: 1 },
      { status: 'forbidden', found: 1, total: 1 },
      { status: 'limited', found: 1, total: 1 },
    ])
    expect(result.findings.find(finding => finding.code === 'card_names_missing')?.params).toEqual({ names: 'Zauberkarte, die es nicht gibt', count: 1 })
    expect(result.cardNames).toMatchObject({ 55144522: 'Pot of Greed', 12580477: 'Raigeki', 40640057: 'Kuriboh' })
    expect(result.cardNamesDe[55144522]).toBe('Topf der Gier')
  })

  it('returns rules the format editor accepts', () => {
    const result = importRulebook(createTestDb(), fixture('origin-legacy.txt'))

    expect(result.name).toBe('Origin Legacy')
    expect(result.rules.rules.length).toBeGreaterThanOrEqual(7)
    expect(result.textLength).toBe(fixture('origin-legacy.txt').length)
    expect(result.cardNames).toEqual({})
  })
})

describe('extractPdfText', () => {
  /** A one-page PDF with the given lines, built by hand. ASCII only, so characters are bytes. */
  function makePdf(lines: string[]): Uint8Array {
    const content = lines.map((line, index) => `BT /F1 12 Tf 50 ${750 - index * 20} Td (${line}) Tj ET`).join('\n')
    const objects = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
      `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ]
    let pdf = '%PDF-1.4\n'
    const offsets: number[] = []
    objects.forEach((object, index) => {
      offsets.push(pdf.length)
      pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
    })
    const xref = pdf.length
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}`
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
    return new TextEncoder().encode(pdf)
  }

  it('returns the printed lines, top to bottom', async () => {
    const text = await extractPdfText(makePdf(['Origin Legacy', '- Main Deck: 40 bis 50 Karten', '- maximal 3 Kopien pro Karte']))

    expect(text.split('\n')).toEqual(['Origin Legacy', '- Main Deck: 40 bis 50 Karten', '- maximal 3 Kopien pro Karte'])
  })

  it('reads what such a PDF says like the pasted text', async () => {
    const text = await extractPdfText(makePdf(['Mini Format', 'Main Deck: 40 bis 50 Karten', 'Maximal 3 Kopien pro Karte']))

    expect(analyzeRulebook(text).rules).toEqual([
      { kind: 'deck_size', section: 'main', min: 40, max: 50 },
      { kind: 'copies', maxCopies: 3 },
    ])
  })

  it('refuses bytes that are not a PDF, with a code', async () => {
    await expect(extractPdfText(new TextEncoder().encode('Das ist kein PDF'))).rejects.toMatchObject({ statusCode: 400, data: { code: 'pdf_unreadable' } })
  })
})
