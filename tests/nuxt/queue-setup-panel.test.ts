import { afterEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { USelect } from '#components'
import QueueSetupPanel from '~/components/tournaments/QueueSetupPanel.vue'
import type { QueueSetupDto, TournamentDetail, TournamentFormatRef } from '~~/shared/tournaments'
import { optionLabels, selectWithOption } from './fixtures/select-wrapper'

enableAutoUnmount(afterEach)

afterEach(() => {
  vi.unstubAllGlobals()
})

const SETUP: QueueSetupDto = { mode: 'swiss', rounds: null, prelaunch: true, flow: 'queue', bestOf: 1, scoring: 'games', tables: 4, duelMinutes: 30 }

/** Only what the panel reads: the organizer of a tournament that has not started, with eleven players. */
function tournament(setup: Partial<QueueSetupDto> = {}, format: TournamentFormatRef | null = null): TournamentDetail {
  return {
    id: 't-1',
    role: 'organizer',
    status: 'registration',
    format,
    queueSetup: { ...SETUP, ...setup },
    participants: Array.from({ length: 11 }, (_, index) => ({ id: `p${index}`, name: `Spieler ${index}` })),
  } as unknown as TournamentDetail
}

function findButton(component: VueWrapper, text: string) {
  const button = component.findAll('button').find(candidate => candidate.text().includes(text))
  if (!button) {
    throw new Error('no button ' + text)
  }
  return button
}

describe('the settings of a duel tournament', () => {
  it('saves after the minutes per duel were typed (a number field hands over a number, not text)', async () => {
    const fetchSpy = vi.fn(async (_url: string, _options?: unknown) => ({ ...tournament({ duelMinutes: 20 }) }))
    vi.stubGlobal('$fetch', fetchSpy)
    const component = await mountSuspended(QueueSetupPanel, { props: { tournament: tournament() } })

    await component.find('input[aria-label="Minuten pro Match"]').setValue('20')
    await component.find('input[aria-label="Tische"]').setValue('3')
    await findButton(component, 'Einstellungen speichern').trigger('click')
    await flushPromises()

    expect(component.text()).not.toContain('konnten nicht gespeichert werden')
    const call = fetchSpy.mock.calls.find(entry => entry[0] === '/api/tournaments/t-1')!
    expect(call[1]).toMatchObject({
      method: 'PATCH',
      // A single game has no score to be told apart by: it is saved as the classic scoring.
      body: { queueMode: 'swiss', flow: 'queue', bestOf: 1, scoring: 'match', plannedRounds: null, prelaunch: true, tables: 3, duelMinutes: 20 },
    })
    expect(component.emitted('updated')).toHaveLength(1)
  })

  it('still shows the estimate while a number is typed in the fields', async () => {
    const component = await mountSuspended(QueueSetupPanel, { props: { tournament: tournament() } })

    await component.find('input[aria-label="Minuten pro Match"]').setValue('20')
    await flushPromises()

    expect(component.find('[data-testid="queue-estimate"]').exists()).toBe(true)
    // 11 players, Swiss with a head start (6 duels each), 4 tables: (11 * 6 / 2) / 4 * 20 + 20 = 185 minutes.
    expect(component.find('[data-testid="queue-estimate"]').text()).toBe('ca. 3 Std. 5 Min.')
  })

  it('asks for the rounds as a whole number typed too (the wish in hours as well)', async () => {
    const component = await mountSuspended(QueueSetupPanel, { props: { tournament: tournament() } })

    await component.find('input[aria-label="Matches pro Spieler"]').setValue('4')
    await component.find('input[aria-label="Gewünschte Gesamtdauer (Stunden)"]').setValue('2')
    await findButton(component, 'Matchzahl vorschlagen').trigger('click')
    await flushPromises()

    expect(component.text()).toContain('Vorschlag:')
  })

  it('lets the organizer choose best of 1 or 3 and the scoring, and has no tables and no way of playing to choose with Spieltage', async () => {
    const fetchSpy = vi.fn(async (_url: string, _options?: unknown) => ({ ...tournament() }))
    vi.stubGlobal('$fetch', fetchSpy)
    const component = await mountSuspended(QueueSetupPanel, { props: { tournament: tournament({ flow: 'rounds', bestOf: 3, scoring: 'match' }) } })

    expect(component.find('input[aria-label="Tische"]').exists()).toBe(false)
    expect(component.find('[aria-label="Turnierart"]').exists()).toBe(false)
    expect(component.find('[aria-label="Punktevergabe"]').exists()).toBe(true)
    expect(component.find('[aria-label="Ein Match ist"]').exists()).toBe(true)
    expect(component.text()).toContain('Best of 3')
    expect(component.text()).toContain('Klassisch (3 · 0)')

    await findButton(component, 'Einstellungen speichern').trigger('click')
    await flushPromises()

    const call = fetchSpy.mock.calls.find(entry => entry[0] === '/api/tournaments/t-1')!
    expect(call[1]).toMatchObject({ body: { flow: 'rounds', bestOf: 3, scoring: 'match' } })
  })

  it('still offers the way of playing and the tables to a tournament made with a queue', async () => {
    const component = await mountSuspended(QueueSetupPanel, { props: { tournament: tournament() } })

    expect(component.find('[aria-label="Turnierart"]').exists()).toBe(true)
    expect(component.find('input[aria-label="Tische"]').exists()).toBe(true)
  })

  it('does not offer the scoring by games for single duels: it is the classic one and cannot be changed there', async () => {
    const single = await mountSuspended(QueueSetupPanel, { props: { tournament: tournament({ bestOf: 1, scoring: 'games' }) } })
    const best = await mountSuspended(QueueSetupPanel, { props: { tournament: tournament({ bestOf: 3, scoring: 'games' }) } })

    expect(single.text()).toContain('Bei Einzelmatches gibt ein Sieg 3 Punkte, eine Niederlage 0')
    expect(single.find('button[aria-label="Punktevergabe"]').attributes('disabled')).toBeDefined()
    expect(single.find('button[aria-label="Punktevergabe"]').text()).toContain('Klassisch (3 · 0)')
    expect(best.text()).not.toContain('Bei Einzelmatches gibt ein Sieg 3 Punkte')
    expect(best.find('button[aria-label="Punktevergabe"]').attributes('disabled')).toBeUndefined()
    expect(best.find('button[aria-label="Punktevergabe"]').text()).toContain('Nach Spielen')
  })

  it('brings back the scoring by games that was chosen when the duel is best of 3 again', async () => {
    const fetchSpy = vi.fn(async (_url: string, _options?: unknown) => ({ ...tournament() }))
    vi.stubGlobal('$fetch', fetchSpy)
    const component = await mountSuspended(QueueSetupPanel, { props: { tournament: tournament({ bestOf: 3, scoring: 'games' }) } })
    const form = (component.vm as unknown as { form: { bestOf: number } }).form

    form.bestOf = 1
    await nextTick()
    expect(component.find('button[aria-label="Punktevergabe"]').text()).toContain('Klassisch (3 · 0)')
    form.bestOf = 3
    await nextTick()
    expect(component.find('button[aria-label="Punktevergabe"]').text()).toContain('Nach Spielen')

    await findButton(component, 'Einstellungen speichern').trigger('click')
    await flushPromises()
    const call = fetchSpy.mock.calls.find(entry => entry[0] === '/api/tournaments/t-1')!
    expect(call[1]).toMatchObject({ body: { bestOf: 3, scoring: 'games' } })
  })

  it('estimates Spieltage by the days, not by the tables', async () => {
    const component = await mountSuspended(QueueSetupPanel, {
      props: { tournament: tournament({ mode: 'champions_league', prelaunch: false, rounds: 6, flow: 'rounds', tables: 1, duelMinutes: 20 }) },
    })

    // 6 days of 20 minutes.
    expect(component.find('[data-testid="queue-estimate"]').text()).toBe('ca. 2 Std. 0 Min.')
  })
})

// Tester feedback, round 10: "Lass mich vor Start nochmal das Format ändern können."
describe('the format of a duel tournament that has not started', () => {
  const FORMATS = [
    { id: 'tcg-advanced', name: 'TCG Advanced', isBuiltin: true },
    { id: 'goat', name: 'GOAT Format', isBuiltin: true },
    { id: 'own-1', name: 'Mein Format', isBuiltin: false },
  ]
  const GOAT = { id: 'goat', name: 'GOAT Format', isBuiltin: true }

  function stubFormatsAndSave() {
    const fetchSpy = vi.fn(async (url: string, _options?: unknown) => (url === '/api/formats' ? { items: FORMATS } : { ...tournament() }))
    vi.stubGlobal('$fetch', fetchSpy)
    return fetchSpy
  }

  const formatSelect = (component: VueWrapper) => selectWithOption(component.findAllComponents(USelect), 'goat')!
  const savedBody = (fetchSpy: ReturnType<typeof stubFormatsAndSave>) =>
    (fetchSpy.mock.calls.find(entry => entry[0] === '/api/tournaments/t-1')![1] as { body: Record<string, unknown> }).body

  it('offers no format and every format, the current one chosen', async () => {
    stubFormatsAndSave()
    const withFormat = await mountSuspended(QueueSetupPanel, { props: { tournament: tournament({}, GOAT) } })
    const without = await mountSuspended(QueueSetupPanel, { props: { tournament: tournament() } })

    // The built-in formats by name, then the organizer's own.
    expect(optionLabels(formatSelect(withFormat))).toEqual(['Ohne Format', 'GOAT Format', 'TCG Advanced', 'Mein Format'])
    expect(withFormat.find('button[aria-label="Format"]').text()).toContain('GOAT Format')
    expect(without.find('button[aria-label="Format"]').text()).toContain('Ohne Format')
  })

  it('saves the format that was picked with the other settings', async () => {
    const fetchSpy = stubFormatsAndSave()
    const component = await mountSuspended(QueueSetupPanel, { props: { tournament: tournament() } })

    await formatSelect(component).setValue('goat')
    await findButton(component, 'Einstellungen speichern').trigger('click')
    await flushPromises()

    expect(savedBody(fetchSpy)).toMatchObject({ formatId: 'goat', queueMode: 'swiss' })
    expect(component.emitted('updated')).toHaveLength(1)
  })

  it('takes the format off again with "Ohne Format" (null on the wire)', async () => {
    const fetchSpy = stubFormatsAndSave()
    const component = await mountSuspended(QueueSetupPanel, { props: { tournament: tournament({}, GOAT) } })

    await formatSelect(component).setValue('none')
    await findButton(component, 'Einstellungen speichern').trigger('click')
    await flushPromises()

    expect(savedBody(fetchSpy)).toHaveProperty('formatId', null)
  })

  it('leaves the format out of the request when it was not changed', async () => {
    const fetchSpy = stubFormatsAndSave()
    const component = await mountSuspended(QueueSetupPanel, { props: { tournament: tournament({}, GOAT) } })

    await findButton(component, 'Einstellungen speichern').trigger('click')
    await flushPromises()

    expect(savedBody(fetchSpy)).not.toHaveProperty('formatId')
  })

  it('keeps a format that is set visible although it is not in the list', async () => {
    stubFormatsAndSave()
    const strange = { id: 'someone-elses', name: 'Fremdes Format', isBuiltin: false }
    const component = await mountSuspended(QueueSetupPanel, { props: { tournament: tournament({}, strange) } })

    expect(component.find('button[aria-label="Format"]').text()).toContain('Fremdes Format')
  })

  it('shows no format select once the tournament has started', async () => {
    stubFormatsAndSave()
    const started = { ...tournament({}, GOAT), status: 'running' } as TournamentDetail
    const component = await mountSuspended(QueueSetupPanel, { props: { tournament: started } })

    expect(component.find('button[aria-label="Format"]').exists()).toBe(false)
  })
})

// Tester feedback, round 15: "gib mir noch den spielmodus, spielabend."
describe('the settings of a Spielabend', () => {
  const EVENING: Partial<QueueSetupDto> = { mode: 'free', flow: 'rounds', rounds: null, bestOf: 1, scoring: 'games', prelaunch: false }

  it('asks for nothing but the format and how a duel is worth points: no rounds, no tables, no minutes, no best-of, no estimate', async () => {
    const component = await mountSuspended(QueueSetupPanel, { props: { tournament: tournament(EVENING) } })

    expect(component.find('input[aria-label="Matches pro Spieler"]').exists()).toBe(false)
    expect(component.find('input[aria-label="Tische"]').exists()).toBe(false)
    expect(component.find('input[aria-label="Minuten pro Match"]').exists()).toBe(false)
    expect(component.find('[aria-label="Ein Match ist"]').exists()).toBe(false)
    expect(component.find('[data-testid="queue-estimate"]').exists()).toBe(false)
    expect(component.find('[data-testid="free-best-of-hint"]').text()).toContain('bei jedem Duell einzeln')
    expect(component.find('[aria-label="Punktevergabe"]').exists()).toBe(true)
    expect(component.find('[aria-label="Modus"]').text()).toContain('Spielabend')
    // The Spielabend is a choice of its own, not something to be steered away from by the recommendation for 11 players.
    expect(component.text()).not.toContain('Empfohlen bei')
  })

  it('still recommends a mode to the other modes', async () => {
    const component = await mountSuspended(QueueSetupPanel, { props: { tournament: tournament({ mode: 'round_robin', flow: 'rounds' }) } })

    expect(component.text()).toContain('Empfohlen bei 11 Spielern')
  })

  it('keeps the scoring by games available although a new duel starts as a single game', async () => {
    const component = await mountSuspended(QueueSetupPanel, { props: { tournament: tournament(EVENING) } })

    expect(component.find('button[aria-label="Punktevergabe"]').attributes('disabled')).toBeUndefined()
    expect(component.find('button[aria-label="Punktevergabe"]').text()).toContain('Nach Spielen')
  })

  it('saves it as a Spielabend without rounds and with the scoring chosen', async () => {
    const fetchSpy = vi.fn(async (_url: string, _options?: unknown) => ({ ...tournament(EVENING) }))
    vi.stubGlobal('$fetch', fetchSpy)
    const component = await mountSuspended(QueueSetupPanel, { props: { tournament: tournament(EVENING) } })

    await findButton(component, 'Einstellungen speichern').trigger('click')
    await flushPromises()

    const call = fetchSpy.mock.calls.find(entry => entry[0] === '/api/tournaments/t-1')!
    expect(call[1]).toMatchObject({ method: 'PATCH', body: { queueMode: 'free', flow: 'rounds', bestOf: 1, scoring: 'games', plannedRounds: null, prelaunch: false } })
  })

  it('changes to the other modes and back: the fields of a plan come back', async () => {
    const component = await mountSuspended(QueueSetupPanel, { props: { tournament: tournament(EVENING) } })
    const form = (component.vm as unknown as { form: { mode: string } }).form

    form.mode = 'champions_league'
    await nextTick()
    expect(component.find('input[aria-label="Matches pro Spieler"]').exists()).toBe(true)
    expect(component.find('[aria-label="Ein Match ist"]').exists()).toBe(true)

    form.mode = 'free'
    await nextTick()
    expect(component.find('input[aria-label="Matches pro Spieler"]').exists()).toBe(false)
  })
})