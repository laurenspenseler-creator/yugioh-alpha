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
    expect(component.find('[aria-label="Ein Duell ist"]').exists()).toBe(true)
    expect(component.find('[aria-label="Punktevergabe"]').exists()).toBe(true)
    expect(component.text()).toContain('Vorlauf')
    expect(component.find('[aria-label="Turnierart"]').exists()).toBe(false)
    expect(component.find('[aria-label="Paarungssystem"]').exists()).toBe(false)
    expect(component.text()).not.toContain('Tische')
    expect(component.text()).not.toContain('Warteschlange')
  })

  it('scores by games unless told otherwise, and says that a single game gives 3 or 0', async () => {
    const component = await mountSuspended(NewTournamentPage)

    expect(formOf(component).scoring).toBe('games')
    expect(component.text()).toContain('Bei Einzelduellen gibt ein Sieg immer 3 Punkte')

    formOf(component).bestOf = 3
    await nextTick()
    expect(component.text()).not.toContain('Bei Einzelduellen gibt ein Sieg immer 3 Punkte')
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
})
