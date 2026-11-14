// The "Zulässigkeit" (format) and "Deckthema" filters of the inventory page (tester feedback, round 14).
import { afterEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount } from '@vue/test-utils'
import { toValue } from 'vue'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import InventoryPage from '~/pages/inventory/index.vue'

// The global auth middleware would bounce `route: '/inventory?…'` to /login without a session.
vi.mock('~/utils/session', () => ({
  getAuthSession: vi.fn(() => Promise.resolve({ session: {}, user: { email: 'fabian@example.com', name: 'Fabian Meyer' } })),
}))

const state = vi.hoisted(() => ({
  calls: [] as Array<{ url: string, opts?: { query?: unknown } }>,
}))

const ATLANTIS = 'Atlantis, City of the Sea Dragon'

mockNuxtImport('useFetch', () => {
  return (url: string, opts?: { query?: unknown }) => {
    state.calls.push({ url, opts })
    if (url === '/api/inventory/search') {
      return { data: ref({ items: [], total: 0, page: 1, pageSize: 24 }), pending: ref(false), error: ref(null), refresh: vi.fn() }
    }
    if (url === '/api/inventory/search/facets') {
      return {
        data: ref({ types: [], attributes: [], races: [], levels: [], archetypes: ['Blue-Eyes', ATLANTIS] }),
        pending: ref(false),
        refresh: vi.fn(),
      }
    }
    if (url === '/api/collections') {
      return { data: ref({ items: [], allCount: 0 }), pending: ref(false), status: ref('success'), refresh: vi.fn() }
    }
    if (url === '/api/formats') {
      return {
        data: ref({ items: [{ id: 'goat', name: 'Goat', isBuiltin: true }, { id: 'edison', name: 'Edison', isBuiltin: true }] }),
        status: ref('success'),
      }
    }
    return { data: ref({ items: [], total: 0 }), pending: ref(false), refresh: vi.fn() }
  }
})

enableAutoUnmount(afterEach)

afterEach(() => {
  state.calls = []
})

function lastQuery(url: string): Record<string, unknown> {
  const call = state.calls.filter(entry => entry.url === url).at(-1)
  return toValue(call?.opts?.query as Record<string, unknown>)
}

describe('the inventory page: format legality and Deckthema', () => {
  it('has a Format and a Deckthema menu, and the Zulässigkeit menu only once a format is picked', async () => {
    const component = await mountSuspended(InventoryPage, { route: '/inventory' })

    expect(component.find('[aria-label="Format"]').exists()).toBe(true)
    expect(component.find('[aria-label="Deckthema"]').exists()).toBe(true)
    expect(component.find('[aria-label="Zulässigkeit"]').exists()).toBe(false)
  })

  it('reads both from a deep link and sends them with the list and the gallery', async () => {
    const component = await mountSuspended(InventoryPage, {
      route: `/inventory?formatId=goat&legality=limited&archetype=Blue-Eyes&archetype=${encodeURIComponent(ATLANTIS)}`,
    })

    for (const url of ['/api/inventory', '/api/inventory/search']) {
      expect(lastQuery(url), url).toMatchObject({ formatId: 'goat', legality: 'limited', archetype: ['Blue-Eyes', ATLANTIS] })
    }
    expect(component.find('[aria-label="Format"]').text()).toContain('GOAT')
    expect(component.find('[aria-label="Zulässigkeit"]').text()).toContain('Limitiert (1 Kopie)')
    // The value in the URL and the query is the English name; the menu shows it in German (round 15).
    expect(component.find('[aria-label="Deckthema"]').text()).toContain('Blauäugiger')
    expect(component.find('[aria-label="Deckthema"]').text()).toContain(ATLANTIS)
  })

  it('writes a picked format and themes to the URL and goes back to page 1; the default legality is not written', async () => {
    const component = await mountSuspended(InventoryPage, { route: '/inventory?page=3' })
    const route = useRouter().currentRoute

    component.findComponent({ name: 'CardFormatFilter' }).vm.$emit('update:formatId', 'edison')
    await vi.waitFor(() => {
      expect(route.value.query.formatId).toBe('edison')
    })
    expect(route.value.query.legality).toBeUndefined()
    expect(route.value.query.page).toBeUndefined()
    expect(lastQuery('/api/inventory')).toMatchObject({ formatId: 'edison', legality: 'legal', page: 1 })

    component.findComponent({ name: 'CardArchetypeFilter' }).vm.$emit('update:modelValue', [ATLANTIS])
    await vi.waitFor(() => {
      expect(route.value.query.archetype).toEqual([ATLANTIS])
    })
    expect(lastQuery('/api/inventory/search')).toMatchObject({ archetype: [ATLANTIS] })
  })

  it('counts as a filter, and "Reset" clears it', async () => {
    const component = await mountSuspended(InventoryPage, { route: '/inventory?formatId=goat&legality=illegal&archetype=Blue-Eyes' })
    const route = useRouter().currentRoute

    const reset = component.findAll('button').find((btn: { text: () => string }) => btn.text() === 'Reset')
    expect(reset).toBeTruthy()
    await reset!.trigger('click')
    await vi.waitFor(() => {
      expect(route.value.query.formatId).toBeUndefined()
    })
    expect(route.value.query.legality).toBeUndefined()
    expect(route.value.query.archetype).toBeUndefined()
    expect(lastQuery('/api/inventory').formatId).toBeUndefined()
    expect(lastQuery('/api/inventory').archetype).toBeUndefined()
  })
})
