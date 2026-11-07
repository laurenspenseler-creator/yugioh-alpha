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
  kind: string
  mode: string
  prelaunch: boolean
  bestOf: number
  plannedRounds: string | number
  includeSelf: boolean
  participantsText: string
}

const formOf = (component: Awaited<ReturnType<typeof mountSuspended>>) => (component.vm as unknown as { form: FormState }).form

describe('the new tournament form', () => {
  it('sends a duel tournament with the way of playing, the mode, the head start, best of and the players typed in', async () => {
    const fetchSpy = vi.fn(async (_url: string, _options?: unknown) => ({ id: 't-9' }))
    vi.stubGlobal('$fetch', fetchSpy)
    const component = await mountSuspended(NewTournamentPage)

    const form = formOf(component)
    form.name = 'Freitag'
    form.kind = 'rounds'
    form.mode = 'swiss'
    form.prelaunch = true
    form.bestOf = 3
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
        includeSelf: true,
        participants: ['Anna', 'Ben', 'clara@example.org'],
      },
    })
    expect(navigate).toHaveBeenCalledWith('/tournaments/t-9')
  })

  it('offers the same mode, head start and best-of choices with tables and with Spieltage, and none of the classic ones', async () => {
    const component = await mountSuspended(NewTournamentPage)
    const form = formOf(component)
    form.mode = 'swiss'

    for (const kind of ['queue', 'rounds']) {
      form.kind = kind
      await nextTick()
      expect(component.find('[aria-label="Modus"]').exists(), kind).toBe(true)
      expect(component.find('[aria-label="Ein Duell ist"]').exists(), kind).toBe(true)
      expect(component.text(), kind).toContain('Vorlauf')
      expect(component.find('[aria-label="Paarungssystem"]').exists(), kind).toBe(false)
    }

    form.kind = 'classic'
    await nextTick()
    expect(component.find('[aria-label="Modus"]').exists()).toBe(false)
    expect(component.find('[aria-label="Paarungssystem"]').exists()).toBe(true)
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

  it('creates a classic tournament after a number was typed into the planned rounds', async () => {
    const fetchSpy = vi.fn(async (_url: string, _options?: unknown) => ({ id: 't-3' }))
    vi.stubGlobal('$fetch', fetchSpy)
    const component = await mountSuspended(NewTournamentPage)
    const form = formOf(component)
    form.name = 'Klassisch'
    form.kind = 'classic'
    await nextTick()

    await component.find('input[type="number"]').setValue('5')
    await component.find('form').trigger('submit')
    await flushPromises()

    const call = fetchSpy.mock.calls.find(entry => entry[0] === '/api/tournaments')!
    expect(call[1]).toMatchObject({ body: { engine: 'classic', pairingSystem: 'swiss', plannedRounds: 5 } })
    expect(component.text()).not.toContain('konnte nicht angelegt werden')
  })
})
