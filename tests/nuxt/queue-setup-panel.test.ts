import { afterEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import QueueSetupPanel from '~/components/tournaments/QueueSetupPanel.vue'
import type { QueueSetupDto, TournamentDetail } from '~~/shared/tournaments'

enableAutoUnmount(afterEach)

afterEach(() => {
  vi.unstubAllGlobals()
})

const SETUP: QueueSetupDto = { mode: 'swiss', rounds: null, prelaunch: true, flow: 'queue', bestOf: 1, scoring: 'games', tables: 4, duelMinutes: 30 }

/** Only what the panel reads: the organizer of a tournament that has not started, with eleven players. */
function tournament(setup: Partial<QueueSetupDto> = {}): TournamentDetail {
  return {
    id: 't-1',
    role: 'organizer',
    status: 'registration',
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

    await component.find('input[aria-label="Minuten pro Duell"]').setValue('20')
    await component.find('input[aria-label="Tische"]').setValue('3')
    await findButton(component, 'Einstellungen speichern').trigger('click')
    await flushPromises()

    expect(component.text()).not.toContain('konnten nicht gespeichert werden')
    const call = fetchSpy.mock.calls.find(entry => entry[0] === '/api/tournaments/t-1')!
    expect(call[1]).toMatchObject({
      method: 'PATCH',
      body: { queueMode: 'swiss', flow: 'queue', bestOf: 1, scoring: 'games', plannedRounds: null, prelaunch: true, tables: 3, duelMinutes: 20 },
    })
    expect(component.emitted('updated')).toHaveLength(1)
  })

  it('still shows the estimate while a number is typed in the fields', async () => {
    const component = await mountSuspended(QueueSetupPanel, { props: { tournament: tournament() } })

    await component.find('input[aria-label="Minuten pro Duell"]').setValue('20')
    await flushPromises()

    expect(component.find('[data-testid="queue-estimate"]').exists()).toBe(true)
    // 11 players, Swiss with a head start (6 duels each), 4 tables: (11 * 6 / 2) / 4 * 20 + 20 = 185 minutes.
    expect(component.find('[data-testid="queue-estimate"]').text()).toBe('ca. 3 Std. 5 Min.')
  })

  it('asks for the rounds as a whole number typed too (the wish in hours as well)', async () => {
    const component = await mountSuspended(QueueSetupPanel, { props: { tournament: tournament() } })

    await component.find('input[aria-label="Duelle pro Spieler"]').setValue('4')
    await component.find('input[aria-label="Gewünschte Gesamtdauer (Stunden)"]').setValue('2')
    await findButton(component, 'Duellzahl vorschlagen').trigger('click')
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
    expect(component.find('[aria-label="Ein Duell ist"]').exists()).toBe(true)
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

  it('points out that the scoring only tells single games apart from best of 3', async () => {
    const single = await mountSuspended(QueueSetupPanel, { props: { tournament: tournament({ bestOf: 1 }) } })
    const best = await mountSuspended(QueueSetupPanel, { props: { tournament: tournament({ bestOf: 3 }) } })

    expect(single.text()).toContain('Bei Einzelduellen gibt ein Sieg immer 3 Punkte')
    expect(best.text()).not.toContain('Bei Einzelduellen gibt ein Sieg immer 3 Punkte')
  })

  it('estimates Spieltage by the days, not by the tables', async () => {
    const component = await mountSuspended(QueueSetupPanel, {
      props: { tournament: tournament({ mode: 'champions_league', prelaunch: false, rounds: 6, flow: 'rounds', tables: 1, duelMinutes: 20 }) },
    })

    // 6 days of 20 minutes.
    expect(component.find('[data-testid="queue-estimate"]').text()).toBe('ca. 2 Std. 0 Min.')
  })
})
