import { afterEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import NewFormatPage from '~/pages/formats/new.vue'
import deErrors from '../../i18n/locales/de/errors.json'
import deFormats from '../../i18n/locales/de/formats.json'
import enErrors from '../../i18n/locales/en/errors.json'
import enFormats from '../../i18n/locales/en/formats.json'
import type { RulebookImport } from '~~/shared/format-rulebook'
import { setTestLocale } from './fixtures/locale'

// "Aus PDF oder Text erstellen" on /formats/new (ADR 0037): the page sends the
// rulebook to /api/formats/analyze, lists what the app understood and what it
// can't check, and fills the format editor below with the rules.

mockNuxtImport('useFetch', () => {
  return (url: string | (() => string)) => {
    const resolvedUrl = typeof url === 'function' ? url() : url
    const data = resolvedUrl === '/api/catalog/facets'
      ? { types: [], attributes: [], races: [], levels: [], sets: [], setsWithoutCards: [] }
      : resolvedUrl === '/api/decks' ? { items: [] } : null
    return { data: ref(data), pending: ref(false), error: ref(null), refresh: vi.fn() }
  }
})

mockNuxtImport('useToast', () => {
  return () => ({ add: vi.fn() })
})

afterEach(async () => {
  await setTestLocale('de')
  vi.unstubAllGlobals()
})

// mountSuspended never unmounts; a later locale switch would re-render every earlier mount (#104).
enableAutoUnmount(afterEach)

const answer: RulebookImport = {
  name: 'Origin Legacy',
  description: '8000 Lebenspunkte',
  rules: {
    rules: [
      { kind: 'deck_size', section: 'main', min: 40, max: 50 },
      { kind: 'copies', maxCopies: 3 },
      { kind: 'card_status', status: 'forbidden', cardIds: [55144522] },
    ],
  },
  findings: [
    { status: 'applied', code: 'main_size', source: 'Main Deck: 40–50 Karten', params: { min: 40, max: 50 } },
    { status: 'applied', code: 'copies', source: 'Maximal 3 Kopien', params: { max: 3 } },
    { status: 'applied', code: 'card_list', source: 'Verboten: Topf der Gier', params: { status: 'forbidden', found: 1, total: 2 } },
    { status: 'decision', code: 'handtrap', source: 'Handtraps sind verboten (außer Kuriboh)', params: { except: 'Kuriboh' } },
    { status: 'unsupported', code: 'card_names_missing', source: 'Verboten: Topf der Gier', params: { names: 'Nicht Existent', count: 1 } },
    { status: 'unsupported', code: 'not_understood', source: 'Wer verliert, räumt auf, wie es der Gewinner verlangt.' },
    { status: 'description', code: 'gameplay', source: '8000 Lebenspunkte' },
  ],
  cardNames: { 55144522: 'Pot of Greed' },
  cardNamesDe: { 55144522: 'Topf der Gier' },
  builtinId: null,
  textLength: 300,
  source: 'text',
}

/** What `POST /api/formats/handtraps` answers for a definition: two cards, "Kuriboh" already taken out. */
const handtrapAnswer = {
  rules: [{ kind: 'card_status', status: 'forbidden', cardIds: [4896788, 14558127] }],
  count: 2,
  cardNames: { 4896788: 'Hand of Nephthys Test', 14558127: 'Ash Blossom & Joyous Spring' },
  cardNamesDe: { 14558127: 'Aschenblüte & Frühlingsregen' },
}

function stubAnalyze(response: RulebookImport | Error) {
  const mock = vi.fn((url: string, _options?: Record<string, unknown>) => {
    if (url === '/api/formats/handtraps') {
      return Promise.resolve(handtrapAnswer)
    }
    return url === '/api/formats/analyze'
      ? (response instanceof Error ? Promise.reject(response) : Promise.resolve(response))
      : Promise.resolve(null)
  })
  vi.stubGlobal('$fetch', mock)
  return mock
}

async function mountPage() {
  return mountSuspended(NewFormatPage)
}

function analyzeButton(component: Awaited<ReturnType<typeof mountPage>>) {
  return component.findAll('button').find(button => button.text().includes('Regeln auswerten'))!
}

describe('format from a rulebook (page)', () => {
  it('sends pasted text, lists the findings by group and fills the editor', async () => {
    const mock = stubAnalyze(answer)
    const component = await mountPage()

    expect(analyzeButton(component).attributes('disabled')).toBeDefined()
    await component.find('textarea[aria-label="Oder Regeltext einfügen"]').setValue('Main Deck: 40–50 Karten')
    await analyzeButton(component).trigger('click')
    await flushPromises()

    expect(mock).toHaveBeenCalledWith('/api/formats/analyze', { method: 'POST', body: { text: 'Main Deck: 40–50 Karten' } })

    const result = component.find('[data-testid="rulebook-result"]')
    expect(result.text()).toContain('3 Regeln erzeugt')
    expect(result.text()).toContain('1 Entscheidung offen')
    expect(result.text()).toContain('1 Punkt nicht prüfbar')

    const applied = component.find('[data-testid="rulebook-group-applied"]').text()
    expect(applied).toContain('Main Deck: 40–50 Karten')
    expect(applied).toContain('Höchstens 3 Kopien pro Karte')
    expect(applied).toContain('Verboten: 1 von 2 genannten Karten im Katalog gefunden')

    // Hand traps are a decision of the user, with the exception of the rulebook.
    expect(component.find('[data-testid="rulebook-group-decision"]').text()).toContain('Handtraps sind verboten (Ausnahme: Kuriboh)')

    // What can't be checked comes with a reason.
    const unsupported = component.find('[data-testid="rulebook-group-unsupported"]').text()
    expect(unsupported).toContain('Warum nicht:')
    expect(unsupported).toContain('1 Karte nicht im Katalog gefunden: Nicht Existent')

    expect(component.find('[data-testid="rulebook-group-unclear"]').text()).toContain('Wer verliert')
    // The sentences nobody needs are folded at first, the rest is open.
    expect(component.find('[data-testid="rulebook-group-unclear"]').attributes('open')).toBeUndefined()
    expect(component.find('[data-testid="rulebook-group-unsupported"]').attributes('open')).toBeDefined()
    expect(component.find('[data-testid="rulebook-group-description"]').text()).toContain('8000 Lebenspunkte')

    // The editor below carries the name, the description and the rules, cards by name.
    expect((component.find('input[aria-label="Formatname"]').element as HTMLInputElement).value).toBe('Origin Legacy')
    expect((component.find('textarea[aria-label="Formatbeschreibung"]').element as HTMLTextAreaElement).value).toBe('8000 Lebenspunkte')
    expect(component.find('[data-testid="rule-summary-0"]').text()).toBe('Main Deck: 40–50 Karten')
    expect(component.find('[data-testid="rule-summary-2"]').text()).toContain('Topf der Gier')
  })

  it('puts the chosen hand-trap definition into the editor, replaces it on another choice and keeps the user\'s edits', async () => {
    const mock = stubAnalyze(answer)
    const component = await mountPage()
    await component.find('textarea[aria-label="Oder Regeltext einfügen"]').setValue('Handtraps sind verboten')
    await analyzeButton(component).trigger('click')
    await flushPromises()

    const choice = component.find('[data-testid="handtrap-choice"]')
    expect(choice.text()).toContain('Was zählt als Handtrap?')
    expect(choice.text()).toContain('Solange nichts gewählt ist')
    const labels = choice.findAll('label').map(label => label.text())
    expect(labels).toEqual(['Classic-Plus-Definition ?', 'Restriktiver ?', 'Eigene Definition ?'])
    // Every option has a grey "?" with its definition.
    expect(choice.findAll('button[aria-label^="Definition von"]')).toHaveLength(3)

    // The user types an extra rule first: a later choice must not take it away.
    await component.find('[aria-label="Regel hinzufügen: Kopien pro Karte"]').trigger('click')
    const rulesBefore = component.findAll('[data-testid^="rule-summary-"]').length

    await choice.findAll('[role="radio"]')[0]!.trigger('click')
    await flushPromises()

    expect(mock).toHaveBeenCalledWith('/api/formats/handtraps', { method: 'POST', body: { definition: 'classic-plus', except: 'Kuriboh' } })
    expect(component.find('[data-testid="handtrap-choice"]').text()).toContain('2 Karten als verboten eingetragen')
    const summaries = component.findAll('[data-testid^="rule-summary-"]').map(summary => summary.text())
    expect(summaries).toHaveLength(rulesBefore + 1)
    expect(summaries.at(-1)).toContain('Verboten')
    // Cards are named in the card language (German here), with the English name as the fallback.
    expect(summaries.at(-1)).toContain('Aschenblüte & Frühlingsregen')
    expect(summaries.at(-1)).toContain('Hand of Nephthys Test')
    expect(component.find('[data-testid="rulebook-result"]').text()).not.toContain('1 Entscheidung offen')

    // Another definition replaces those rules instead of adding to them.
    await choice.findAll('[role="radio"]')[1]!.trigger('click')
    await flushPromises()
    expect(mock).toHaveBeenCalledWith('/api/formats/handtraps', { method: 'POST', body: { definition: 'restrictive', except: 'Kuriboh' } })
    expect(component.findAll('[data-testid^="rule-summary-"]')).toHaveLength(rulesBefore + 1)

    // "Eigene Definition" takes them out again and says to put the definition into the PDF.
    await choice.findAll('[role="radio"]')[2]!.trigger('click')
    await flushPromises()
    expect(component.findAll('[data-testid^="rule-summary-"]')).toHaveLength(rulesBefore)
    expect(component.find('[data-testid="handtrap-own"]').text()).toContain('lade es noch einmal hoch')
  })

  it('sends a chosen PDF as a file, and the file wins over the text', async () => {
    const mock = stubAnalyze({ ...answer, source: 'pdf' })
    const component = await mountPage()

    const input = component.find('input[type="file"]')
    const file = new File(['%PDF-1.4'], 'regeln.pdf', { type: 'application/pdf' })
    Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
    await input.trigger('change')

    expect(component.find('[data-testid="rulebook-file"]').text()).toContain('regeln.pdf')
    expect(component.find('textarea[aria-label="Oder Regeltext einfügen"]').attributes('disabled')).toBeDefined()

    await analyzeButton(component).trigger('click')
    await flushPromises()

    const [, options] = mock.mock.calls.find(([url]) => url === '/api/formats/analyze')!
    const body = (options as { body: FormData }).body
    expect(body).toBeInstanceOf(FormData)
    expect((body.get('file') as File).name).toBe('regeln.pdf')
  })

  it('refuses a file that is not a PDF before it is sent', async () => {
    const mock = stubAnalyze(answer)
    const component = await mountPage()

    const input = component.find('input[type="file"]')
    Object.defineProperty(input.element, 'files', { value: [new File(['x'], 'regeln.docx')], configurable: true })
    await input.trigger('change')

    expect(component.text()).toContain('Das ist kein PDF.')
    expect(component.find('[data-testid="rulebook-file"]').exists()).toBe(false)
    expect(mock).not.toHaveBeenCalled()
  })

  it('shows the error of the server in words', async () => {
    stubAnalyze(Object.assign(new Error('x'), { data: { data: { code: 'pdf_no_text' } } }))
    const component = await mountPage()

    await component.find('textarea[aria-label="Oder Regeltext einfügen"]').setValue('irgendwas')
    await analyzeButton(component).trigger('click')
    await flushPromises()

    expect(component.find('[role="alert"]').text()).toContain('kein Text')
    expect(component.find('[data-testid="rulebook-result"]').exists()).toBe(false)
  })
})

describe('finding texts', () => {
  // Every code the analyzer and the import produce, as listed in format-rulebook.ts / format-import.ts.
  const textOnly = ['size', 'limitMin', 'limitMax', 'limitBoth', 'no_side', 'copies', 'extra_fusion_only', 'modern_summons', 'gemini', 'effects_limited', 'banlist', 'card_list', 'builtin_exists', 'text_mention', 'instant_win', 'receiver', 'handtrap']
  const withReason = ['sleeves', 'effect_class', 'banlist_unknown', 'card_names_missing', 'rule_invalid', 'too_many_rules', 'not_understood']

  for (const [language, formats] of [['de', deFormats], ['en', enFormats]] as const) {
    it(`has a text for every finding, and a reason for every unsupported one (${language})`, () => {
      const findings = formats.formats.pdf.finding as Record<string, { text?: string, why?: string }>

      for (const code of [...textOnly, ...withReason]) {
        expect(findings[code]?.text, `${code}.text`).toBeTruthy()
      }
      for (const code of withReason) {
        expect(findings[code]?.why, `${code}.why`).toBeTruthy()
      }
      expect(Object.keys(findings).sort()).toEqual([...textOnly, ...withReason].sort())
    })
  }

  it('has the error messages of the endpoint in both languages', () => {
    for (const errors of [deErrors, enErrors]) {
      for (const code of ['format_file_required', 'format_file_too_large', 'pdf_unreadable', 'pdf_no_text', 'rulebook_empty', 'rulebook_too_long']) {
        expect((errors.errors.api as Record<string, string>)[code], code).toBeTruthy()
      }
    }
  })
})
