import { afterEach, describe, expect, it, vi } from 'vitest'
import { DOMWrapper, enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { UDropdownMenu } from '#components'
import TournamentsPage from '~/pages/tournaments/index.vue'
import type { TournamentListItem, TournamentListResponse } from '~~/shared/tournaments'
import { setTestLocale } from './fixtures/locale'

const state = vi.hoisted(() => ({
  list: { items: [] as TournamentListItem[], total: 0, page: 1, pageSize: 20 } as TournamentListResponse,
  // The "other role" count-only fetch (pageSize: 1) used to label the tab
  // the user isn't currently on and to drive the empty-state hint.
  otherList: { items: [] as TournamentListItem[], total: 0, page: 1, pageSize: 1 } as TournamentListResponse,
  // Captured queries are computed refs, so their `.value` keeps reflecting
  // the page's reactive filter state after the fact.
  lastQueryRef: undefined as { value: Record<string, unknown> } | undefined,
  otherQueryRef: undefined as { value: Record<string, unknown> } | undefined,
  refresh: vi.fn(),
  refreshOther: vi.fn(),
}))

const confirmSpy = vi.hoisted(() => vi.fn(async (_options: unknown) => true))
mockNuxtImport('useConfirm', () => () => ({ confirm: confirmSpy }))

afterEach(async () => {
  // The rename dialog teleports its content to <body>.
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
  confirmSpy.mockReset()
  confirmSpy.mockResolvedValue(true)
  state.refresh.mockClear()
  state.refreshOther.mockClear()
  await setTestLocale('de')
})

// mountSuspended never unmounts; a later locale switch would re-render every earlier mount (#104). Registered after the
// clean-up above, so it runs before it (afterEach hooks run in reverse order) and unmounts into a body that is still there.
enableAutoUnmount(afterEach)

mockNuxtImport('useFetch', () => {
  return (url: string | (() => string), options?: { query?: { value: Record<string, unknown> } }) => {
    const resolvedUrl = typeof url === 'function' ? url() : url
    if (resolvedUrl === '/api/tournaments') {
      const query = options?.query
      // The count-only fetch always asks for pageSize 1; distinguish it from
      // the main list fetch so tests can control each independently.
      if (query?.value?.pageSize === 1) {
        state.otherQueryRef = query
        return { data: ref(state.otherList), pending: ref(false), refresh: state.refreshOther }
      }
      state.lastQueryRef = query
      return { data: ref(state.list), pending: ref(false), refresh: state.refresh }
    }
    return { data: ref(null), pending: ref(false), refresh: vi.fn() }
  }
})

function item(overrides: Partial<TournamentListItem> = {}): TournamentListItem {
  return {
    id: 'tournament-1',
    name: 'Freitagsturnier',
    description: null,
    status: 'registration',
    pairingSystem: 'swiss',
    engine: 'classic',
    queueMode: null,
    format: null,
    organizerName: 'Alice',
    role: 'organizer',
    participantCount: 4,
    roundCount: 1,
    plannedRounds: 3,
    createdAt: '2025-01-01T00:00:00.000Z',
    startedAt: null,
    finishedAt: null,
    updatedAt: '2025-01-02T00:00:00.000Z',
    ...overrides,
  }
}

describe('tournaments page', () => {
  it('renders the role tabs, the status toggle and the create button', async () => {
    state.list = { items: [], total: 0, page: 1, pageSize: 20 }
    state.otherList = { items: [], total: 0, page: 1, pageSize: 1 }

    const component = await mountSuspended(TournamentsPage)
    const text = component.text()

    expect(text).toContain('Meine Turniere')
    expect(text).toContain('Teilnahmen')
    expect(text).toContain('Aktiv')
    expect(text).toContain('Abgeschlossen')
    expect(text).toContain('Neues Turnier')
  })

  it('labels each role tab with its tournament count', async () => {
    state.list = { items: [item()], total: 1, page: 1, pageSize: 20 }
    state.otherList = { items: [], total: 3, page: 1, pageSize: 1 }

    const component = await mountSuspended(TournamentsPage)
    const text = component.text()

    expect(text).toContain('Meine Turniere (1)')
    expect(text).toContain('Teilnahmen (3)')
  })

  it('renders the status badge, participant count and round progress', async () => {
    state.list = {
      items: [item({ status: 'running', roundCount: 1, plannedRounds: 3, participantCount: 4 })],
      total: 1,
      page: 1,
      pageSize: 20,
    }
    state.otherList = { items: [], total: 0, page: 1, pageSize: 1 }

    const component = await mountSuspended(TournamentsPage)
    const text = component.text()

    expect(text).toContain('Läuft')
    expect(text).toContain('4 Teilnehmer')
    expect(text).toContain('Runde 1/3')
  })

  it('names the mode of a duel queue instead of a round count and a pairing system', async () => {
    state.list = {
      items: [item({ engine: 'queue', queueMode: 'champions_league', pairingSystem: 'swiss', status: 'running', roundCount: 0, plannedRounds: 4, participantCount: 10 })],
      total: 1,
      page: 1,
      pageSize: 20,
    }
    state.otherList = { items: [], total: 0, page: 1, pageSize: 1 }

    const component = await mountSuspended(TournamentsPage)
    const text = component.text()

    expect(text).toContain('Champions League')
    expect(text).not.toContain('Runde 0/4')
    expect(text).not.toContain('Schweizer System')
  })

  it('shows the organizer empty state and switches to the participant empty state', async () => {
    state.list = { items: [], total: 0, page: 1, pageSize: 20 }
    state.otherList = { items: [], total: 0, page: 1, pageSize: 1 }

    const component = await mountSuspended(TournamentsPage)

    expect(component.text()).toContain('Noch keine Turniere')

    await component.findAll('button').find(button => button.text().startsWith('Teilnahmen'))!.trigger('click')
    await component.vm.$nextTick()

    expect(component.text()).toContain('Keine Teilnahmen')
  })

  it('hints at "Teilnahmen" when "Meine Turniere" is empty but participations exist', async () => {
    state.list = { items: [], total: 0, page: 1, pageSize: 20 }
    state.otherList = { items: [], total: 1, page: 1, pageSize: 1 }

    const component = await mountSuspended(TournamentsPage)
    const text = component.text()

    expect(text).toContain('Noch keine Turniere')
    expect(text).toContain('Du nimmst an 1 Turnier teil.')
    expect(text).toContain('Eingeladene Turniere ansehen')
  })

  it('shows an abgeschlossen-specific empty state when the status toggle is switched', async () => {
    state.list = { items: [], total: 0, page: 1, pageSize: 20 }
    state.otherList = { items: [], total: 0, page: 1, pageSize: 1 }

    const component = await mountSuspended(TournamentsPage)
    await component.findAll('button').find(button => button.text() === 'Abgeschlossen')!.trigger('click')
    await component.vm.$nextTick()

    expect(component.text()).toContain('Noch keine abgeschlossenen Turniere')
  })

  it('updates the query sent to useFetch when role or status changes, keeping the two axes independent', async () => {
    state.list = { items: [], total: 0, page: 1, pageSize: 20 }
    state.otherList = { items: [], total: 0, page: 1, pageSize: 1 }

    const component = await mountSuspended(TournamentsPage)

    expect(state.lastQueryRef?.value).toEqual({ role: 'organizer', status: 'active', page: 1, pageSize: 20 })

    await component.findAll('button').find(button => button.text().startsWith('Teilnahmen'))!.trigger('click')
    await component.vm.$nextTick()

    expect(state.lastQueryRef?.value).toEqual({ role: 'participant', status: 'active', page: 1, pageSize: 20 })

    // The status toggle is independent of the role tab: switching it keeps
    // the role that was already selected (#32 — these used to be a single
    // mixed axis).
    await component.findAll('button').find(button => button.text() === 'Abgeschlossen')!.trigger('click')
    await component.vm.$nextTick()

    expect(state.lastQueryRef?.value).toEqual({ role: 'participant', status: 'finished', page: 1, pageSize: 20 })
  })

  it('renders in English', async () => {
    await setTestLocale('en')
    state.list = {
      items: [
        item({ status: 'running', pairingSystem: 'round_robin', participantCount: 4, roundCount: 1, plannedRounds: null }),
        item({ id: 'tournament-2', name: 'Samstagsturnier', status: 'registration', participantCount: 1, roundCount: 0, plannedRounds: 3 }),
      ],
      total: 1234,
      page: 1,
      pageSize: 20,
    }
    state.otherList = { items: [], total: 3, page: 1, pageSize: 1 }

    const component = await mountSuspended(TournamentsPage)
    const text = component.text()

    expect(component.find('h1').text()).toBe('Tournaments')
    expect(text).toContain('1,234 tournaments')
    expect(text).toContain('New tournament')
    expect(text).toContain('My tournaments (1,234)')
    expect(text).toContain('Participations (3)')
    expect(text).toContain('Active')
    expect(text).toContain('Finished')
    expect(text).toContain('Running')
    expect(text).toContain('Registration')
    expect(text).toContain('Round robin')
    expect(text).toContain('Swiss')
    expect(text).toContain('4 participants')
    expect(text).toContain('1 participant')
    expect(text).toContain('Round 1/–')
    expect(text).toContain('Round 0/3')
    expect(text).not.toContain('Turniere')
    expect(text).not.toContain('Teilnehmer')
  })

  describe('the options of a tournament card', () => {
    type MenuItem = { label: string, icon?: string, color?: string, onSelect: () => void }

    function menuOf(component: Awaited<ReturnType<typeof mountSuspended>>, index = 0): MenuItem[] {
      const menus = component.findAllComponents(UDropdownMenu) as unknown as Array<{ props: (key: string) => unknown }>
      return (menus[index]!.props('items') as MenuItem[][]).flat()
    }

    it('puts three dots in the upper right corner of every card of the organizer, and none on a participation', async () => {
      state.list = {
        items: [item(), item({ id: 'tournament-2', name: 'Fremdes Turnier', role: 'participant', organizerName: 'Bob' })],
        total: 2,
        page: 1,
        pageSize: 20,
      }
      state.otherList = { items: [], total: 0, page: 1, pageSize: 1 }

      const component = await mountSuspended(TournamentsPage)

      const buttons = component.findAll('[data-testid="tournament-menu"]')
      expect(buttons).toHaveLength(1)
      expect(buttons[0]!.attributes('aria-label')).toBe('Optionen')
      expect(buttons[0]!.classes()).toEqual(expect.arrayContaining(['absolute', 'right-2', 'top-2']))
      expect(component.findAll('[data-testid="tournament-card"]')[0]!.classes()).toContain('relative')
    })

    it('offers renaming and deleting, for a running tournament too', async () => {
      state.list = { items: [item({ status: 'running' })], total: 1, page: 1, pageSize: 20 }
      state.otherList = { items: [], total: 0, page: 1, pageSize: 1 }

      const component = await mountSuspended(TournamentsPage)
      const items = menuOf(component)

      expect(items.map(entry => entry.label)).toEqual(['Umbenennen', 'Löschen'])
      expect(items[1]!.color).toBe('error')
    })

    it('renames a tournament in a dialog and reloads the list', async () => {
      state.list = { items: [item()], total: 1, page: 1, pageSize: 20 }
      state.otherList = { items: [], total: 0, page: 1, pageSize: 1 }
      const fetchMock = vi.fn(async () => ({}))
      vi.stubGlobal('$fetch', fetchMock)

      const component = await mountSuspended(TournamentsPage, { attachTo: document.body })
      menuOf(component)[0]!.onSelect()
      await flushPromises()

      const input = new DOMWrapper(document.body).find('input[aria-label="Name des Turniers"]')
      expect(input.exists()).toBe(true)
      expect((input.element as HTMLInputElement).value).toBe('Freitagsturnier')

      await input.setValue('Samstagsturnier')
      await new DOMWrapper(document.body).find('[role="dialog"] form').trigger('submit')
      await flushPromises()

      expect(fetchMock).toHaveBeenCalledWith('/api/tournaments/tournament-1', { method: 'PATCH', body: { name: 'Samstagsturnier' } })
      expect(state.refresh).toHaveBeenCalledTimes(1)
      expect(new DOMWrapper(document.body).find('[role="dialog"]').exists()).toBe(false)
    })

    it('does not ask the server when the name stays as it is', async () => {
      state.list = { items: [item()], total: 1, page: 1, pageSize: 20 }
      state.otherList = { items: [], total: 0, page: 1, pageSize: 1 }
      const fetchMock = vi.fn(async () => ({}))
      vi.stubGlobal('$fetch', fetchMock)

      const component = await mountSuspended(TournamentsPage, { attachTo: document.body })
      menuOf(component)[0]!.onSelect()
      await flushPromises()
      await new DOMWrapper(document.body).find('[role="dialog"] form').trigger('submit')
      await flushPromises()

      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('shows why a rename failed and keeps the dialog open', async () => {
      state.list = { items: [item()], total: 1, page: 1, pageSize: 20 }
      state.otherList = { items: [], total: 0, page: 1, pageSize: 1 }
      vi.stubGlobal('$fetch', vi.fn(async () => { throw new Error('offline') }))

      const component = await mountSuspended(TournamentsPage, { attachTo: document.body })
      menuOf(component)[0]!.onSelect()
      await flushPromises()
      const body = new DOMWrapper(document.body)
      await body.find('input[aria-label="Name des Turniers"]').setValue('Neu')
      await body.find('[role="dialog"] form').trigger('submit')
      await flushPromises()

      expect(body.find('[role="dialog"]').text()).toContain('Das Turnier konnte nicht umbenannt werden.')
      expect(state.refresh).not.toHaveBeenCalled()
    })

    it('deletes a tournament after a confirmation and reloads both counts', async () => {
      state.list = { items: [item({ status: 'running' })], total: 1, page: 1, pageSize: 20 }
      state.otherList = { items: [], total: 0, page: 1, pageSize: 1 }
      const fetchMock = vi.fn(async () => undefined)
      vi.stubGlobal('$fetch', fetchMock)

      const component = await mountSuspended(TournamentsPage)
      menuOf(component)[1]!.onSelect()
      await flushPromises()

      expect(confirmSpy).toHaveBeenCalledWith(expect.objectContaining({
        title: 'Turnier löschen',
        description: expect.stringContaining('"Freitagsturnier" wirklich löschen?'),
      }))
      expect(fetchMock).toHaveBeenCalledWith('/api/tournaments/tournament-1', { method: 'DELETE' })
      expect(state.refresh).toHaveBeenCalledTimes(1)
      expect(state.refreshOther).toHaveBeenCalledTimes(1)
    })

    it('keeps the tournament when the confirmation is declined', async () => {
      state.list = { items: [item()], total: 1, page: 1, pageSize: 20 }
      state.otherList = { items: [], total: 0, page: 1, pageSize: 1 }
      const fetchMock = vi.fn(async () => undefined)
      vi.stubGlobal('$fetch', fetchMock)
      confirmSpy.mockResolvedValueOnce(false)

      const component = await mountSuspended(TournamentsPage)
      menuOf(component)[1]!.onSelect()
      await flushPromises()

      expect(fetchMock).not.toHaveBeenCalled()
      expect(state.refresh).not.toHaveBeenCalled()
    })

    it('says so when deleting fails', async () => {
      state.list = { items: [item()], total: 1, page: 1, pageSize: 20 }
      state.otherList = { items: [], total: 0, page: 1, pageSize: 1 }
      vi.stubGlobal('$fetch', vi.fn(async () => { throw new Error('offline') }))

      const component = await mountSuspended(TournamentsPage)
      menuOf(component)[1]!.onSelect()
      await flushPromises()

      expect(component.find('[role="alert"]').text()).toBe('Das Turnier konnte nicht gelöscht werden.')
      expect(state.refresh).not.toHaveBeenCalled()
    })
  })

  it('renders the English empty state and participation hint', async () => {
    await setTestLocale('en')
    state.list = { items: [], total: 0, page: 1, pageSize: 20 }
    state.otherList = { items: [], total: 1, page: 1, pageSize: 1 }

    const component = await mountSuspended(TournamentsPage)
    const text = component.text()

    expect(text).toContain('No tournaments yet')
    expect(text).toContain('You\'re taking part in 1 tournament.')
    expect(text).toContain('View tournaments you\'re invited to')
  })
})
