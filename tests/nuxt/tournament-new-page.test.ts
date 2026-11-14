import { afterEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import NewTournamentPage from '~/pages/tournaments/new.vue'

enableAutoUnmount(afterEach)

const navigate = vi.hoisted(() => vi.fn())
mockNuxtImport('navigateTo', () => navigate)
mockNuxtImport('useFetch', () => {
  return (_url: unknown, options?: { default?: () => unknown }) => ({
    data: ref(options?.default?.() ?? null),
    pending: ref(false),
    error: ref(null),
    refresh: vi.fn(),
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  navigate.mockReset()
})

interface FormState {
  name: string
  mode: string
  prelaunch: boolean
  bestOf: number
  scoring: string
  includeSelf: boolean
  participantsText: string
}

const formOf = (component: Awaited<ReturnType<typeof mountSuspended>>) => (component.vm as unknown as { form: FormState }).form

describe('the new tournament form', () => {
  it('makes a tournament played in Spieltage with the mode, the head start, best of, the scoring and the players typed in', async () => {
    const fetchSpy = vi.fn(async (_url: string, _options?: unknown) => ({ id: 't-9' }))
    vi.stubGlobal('$fetch', fetchSpy)
    const component = await mountSuspended(NewTournamentPage)

    const form = formOf(component)
    form.name = 'Freitag'
    form.mode = 'swiss'
    form.prelaunch = true
    form.bestOf = 3
    form.scoring = 'match'
    form.participantsText = 'Anna\n\n  Ben  \nclara@example.org\n'
    await component.find('form').trigger('submit')
    await flushPromises()

    const call = fetchSpy.mock.calls.find(entry => entry[0] === '/api/tournaments')!
    expect(call[1]).toMatchObject({
      method: 'POST',
      body: {
        name: 'Freitag',
        engine: 'queue',
        flow: 'rounds',
        mode: 'swiss',
        prelaunch: true,
        bestOf: 3,
        scoring: 'match',
        includeSelf: true,
        participants: ['Anna', 'Ben', 'clara@example.org'],
      },
    })
    expect(navigate).toHaveBeenCalledWith('/tournaments/t-9')
  })

  it('offers every choice to everybody: mode, head start, best of and the scoring, but no kind of tournament and no tables', async () => {
    const component = await mountSuspended(NewTournamentPage)
    formOf(component).mode = 'swiss'
    await nextTick()

    expect(component.find('[aria-label="Modus"]').exists()).toBe(true)
    expect(component.find('[aria-label="Ein Match ist"]').exists()).toBe(true)
    expect(component.find('[aria-label="Punktevergabe"]').exists()).toBe(true)
    expect(component.text()).toContain('Vorlauf')
    expect(component.find('[aria-label="Turnierart"]').exists()).toBe(false)
    expect(component.find('[aria-label="Paarungssystem"]').exists()).toBe(false)
    expect(component.text()).not.toContain('Tische')
    expect(component.text()).not.toContain('Warteschlange')
  })

  // Tester feedback, round 12: "Stell Best of 3 als Standard ein."
  it('starts with best of 3, and with the scoring by games that goes with it', async () => {
    const fetchSpy = vi.fn(async (_url: string, _options?: unknown) => ({ id: 't-9' }))
    vi.stubGlobal('$fetch', fetchSpy)
    const component = await mountSuspended(NewTournamentPage)

    expect(formOf(component).bestOf).toBe(3)
    expect(component.find('button[aria-label="Ein Match ist"]').text()).toContain('Best of 3')
    expect(component.find('button[aria-label="Punktevergabe"]').text()).toContain('Nach Spielen')

    formOf(component).name = 'Freitag'
    await component.find('form').trigger('submit')
    await flushPromises()
    expect(fetchSpy.mock.calls.find(entry => entry[0] === '/api/tournaments')![1]).toMatchObject({ body: { bestOf: 3, scoring: 'games' } })
  })

  it('does not mix single duels with the scoring by games: it shows the classic scoring there, disabled, and sends that', async () => {
    const fetchSpy = vi.fn(async (_url: string, _options?: unknown) => ({ id: 't-9' }))
    vi.stubGlobal('$fetch', fetchSpy)
    const component = await mountSuspended(NewTournamentPage)
    const scoring = () => component.find('button[aria-label="Punktevergabe"]')

    // Best of 3 is the default: the scoring by games can be chosen.
    expect(formOf(component).bestOf).toBe(3)
    expect(scoring().attributes('disabled')).toBeUndefined()
    expect(component.text()).not.toContain('Bei Einzelmatches gibt ein Sieg 3 Punkte')

    // A single game has nothing to tell apart by games, so 3 and 0.
    formOf(component).bestOf = 1
    await nextTick()
    expect(scoring().attributes('disabled')).toBeDefined()
    expect(scoring().text()).toContain('Klassisch (3 · 0)')
    expect(component.text()).toContain('Bei Einzelmatches gibt ein Sieg 3 Punkte, eine Niederlage 0')

    formOf(component).name = 'Freitag'
    await component.find('form').trigger('submit')
    await flushPromises()
    expect(fetchSpy.mock.calls.find(entry => entry[0] === '/api/tournaments')![1]).toMatchObject({ body: { bestOf: 1, scoring: 'match' } })

    // Best of 3 again: the scoring by games is the choice again.
    formOf(component).bestOf = 3
    await nextTick()
    expect(formOf(component).scoring).toBe('games')
    expect(scoring().attributes('disabled')).toBeUndefined()
    expect(scoring().text()).toContain('Nach Spielen')
  })

  it('sends the decks written in brackets behind a name as part of the line, and counts one player per line', async () => {
    const fetchSpy = vi.fn(async (_url: string, _options?: unknown) => ({ id: 't-9' }))
    vi.stubGlobal('$fetch', fetchSpy)
    const component = await mountSuspended(NewTournamentPage)
    const form = formOf(component)

    form.name = 'Decks'
    form.participantsText = 'ANna (blue eyes, Grabwächter)\nFabi ( antiker antrieb, Cyber drache)\nDarius ( Dark magician / Blue eyes )'
    await nextTick()
    expect(component.find('[data-testid="new-participant-count"]').text()).toBe('Teilnehmer: 4')
    expect(component.text()).toContain('Decks stehen in Klammern hinter dem Namen')

    await component.find('form').trigger('submit')
    await flushPromises()
    expect(fetchSpy.mock.calls.find(entry => entry[0] === '/api/tournaments')![1]).toMatchObject({
      body: { participants: ['ANna (blue eyes, Grabwächter)', 'Fabi ( antiker antrieb, Cyber drache)', 'Darius ( Dark magician / Blue eyes )'] },
    })
  })

  it('counts the players typed in, with the organizer when they play', async () => {
    const component = await mountSuspended(NewTournamentPage)
    const form = formOf(component)

    form.participantsText = 'Anna\nBen'
    await nextTick()
    expect(component.find('[data-testid="new-participant-count"]').text()).toBe('Teilnehmer: 3')

    form.includeSelf = false
    await nextTick()
    expect(component.find('[data-testid="new-participant-count"]').text()).toBe('Teilnehmer: 2')
  })

  // Tester feedback, round 15: "gib mir noch den spielmodus, spielabend."
  it('offers the Spielabend as a mode and leaves the best-of to each duel', async () => {
    const component = await mountSuspended(NewTournamentPage)

    expect(component.find('[data-testid="free-best-of-hint"]').exists()).toBe(false)
    formOf(component).mode = 'free'
    await nextTick()

    expect(component.find('button[aria-label="Modus"]').text()).toContain('Spielabend')
    expect(component.text()).toContain('Kein Spielplan')
    expect(component.find('[aria-label="Ein Match ist"]').exists()).toBe(false)
    expect(component.find('[data-testid="free-best-of-hint"]').text()).toContain('bei jedem Duell einzeln')
    expect(component.text()).not.toContain('Vorlauf')
  })

  it('keeps the scoring by games for a Spielabend, even when a new duel starts as a single game, and sends the mode', async () => {
    const fetchSpy = vi.fn(async (_url: string, _options?: unknown) => ({ id: 't-9' }))
    vi.stubGlobal('$fetch', fetchSpy)
    const component = await mountSuspended(NewTournamentPage)
    const form = formOf(component)

    form.mode = 'free'
    form.bestOf = 1
    form.name = 'Spielabend'
    form.participantsText = 'Anna\nBen'
    await nextTick()
    expect(component.find('button[aria-label="Punktevergabe"]').attributes('disabled')).toBeUndefined()

    await component.find('form').trigger('submit')
    await flushPromises()

    expect(fetchSpy.mock.calls.find(entry => entry[0] === '/api/tournaments')![1]).toMatchObject({
      method: 'POST',
      body: { name: 'Spielabend', engine: 'queue', mode: 'free', flow: 'rounds', prelaunch: false, scoring: 'games', participants: ['Anna', 'Ben'] },
    })
  })
})
