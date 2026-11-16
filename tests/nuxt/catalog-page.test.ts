import { afterEach, describe, expect, it, vi } from 'vitest'
import { DOMWrapper, flushPromises } from '@vue/test-utils'
import { nextTick, toValue } from 'vue'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { CardDetailModal, CardFacetFilters, USelect } from '#components'
import CatalogPage from '~/pages/catalog.vue'
import { setTestLocale } from './fixtures/locale'
import { expectRouteKept } from './fixtures/route'
import { selectWithOption } from './fixtures/select-wrapper'

// The global auth middleware would bounce `route: '/catalog?…'` to /login
// without a session — stub it so the page sees its own query.
vi.mock('~/utils/session', () => ({
  getAuthSession: vi.fn(() => Promise.resolve({ session: {}, user: { email: 'fabian@example.com', name: 'Fabian Meyer' } })),
}))

const catalogState = vi.hoisted(() => ({
  total: 1,
  // One `pending` for the card search across mounts, so a test can flip the
  // grid to its loading skeletons (#98).
  searchPending: null as null | { value: boolean },
  // Every `useFetch(url, opts)` call, so tests can read the reactive query.
  calls: [] as Array<{ url: string, opts?: { query?: unknown } }>,
  // Replaces the one Blue-Eyes result when set.
  items: null as null | Array<Record<string, unknown>>,
}))

function lastQuery(url: string): Record<string, unknown> {
  const call = catalogState.calls.filter(c => c.url === url).at(-1)
  return toValue(call?.opts?.query as Record<string, unknown>)
}

// UModal teleports its content to <body> (same note as in collections-ui.test.ts).
function body() {
  return new DOMWrapper(document.body)
}

// Every mounted page is unmounted before the body is cleared: a page left
// mounted (with its teleported modal) would re-render into the cleared body
// on the next route change.
const mounted: Array<{ unmount: () => void }> = []

async function mountPage(options: { route?: string } = {}) {
  const component = await mountSuspended(CatalogPage, options)
  mounted.push(component)
  if (options.route) expectRouteKept(options.route)
  return component
}

afterEach(async () => {
  for (const component of mounted.splice(0)) {
    component.unmount()
  }
  document.body.innerHTML = ''
  catalogState.total = 1
  catalogState.calls = []
  catalogState.items = null
  if (catalogState.searchPending) {
    catalogState.searchPending.value = false
  }
  useState('card-locale-choice').value = null
  vi.unstubAllGlobals()
  await useRouter().replace('/catalog')
  await setTestLocale('de')
})

function cardDetail(overrides: { nameDe?: string | null, descDe?: string | null } = {}, printings: Array<{ setCode: string, setName: string, rarity: string | null, price: string | null }> = []) {
  return {
    card: {
      id: 1,
      name: 'Blue-Eyes White Dragon',
      nameDe: 'Blauäugiger w. Drache',
      type: 'Normal Monster',
      frameType: 'normal',
      desc: 'This legendary dragon is a powerful engine of destruction.',
      descDe: 'Dieser legendäre Drache ist eine mächtige Zerstörungsmaschine.',
      race: 'Dragon',
      archetype: null,
      attribute: 'LIGHT',
      atk: 3000,
      def: 2500,
      level: 8,
      linkval: null,
      scale: null,
      linkMarkers: null,
      banlistInfo: null,
      cardPrices: null,
      tcgDate: null,
      ocgDate: null,
      ygoprodeckUrl: null,
      ...overrides,
    },
    printings,
    images: [],
  }
}

async function openDetail(detail: ReturnType<typeof cardDetail>) {
  vi.stubGlobal('$fetch', vi.fn(() => Promise.resolve(detail)))
  // The detail opens through the route (`?card=`), then loads the card.
  const component = await mountPage({ route: '/catalog?card=1' })
  await flushPromises()
  return component
}

mockNuxtImport('useFetch', () => {
  return vi.fn((url: string | (() => string | null), opts?: { query?: unknown }) => {
    const resolvedUrl = typeof url === 'function' ? url() : url
    catalogState.calls.push({ url: resolvedUrl ?? '', opts })

    if (resolvedUrl === '/api/catalog/facets') {
      return {
        data: ref({
          types: ['Normal Monster'],
          attributes: ['LIGHT'],
          races: ['Dragon'],
          levels: [8],
          archetypes: ['Blue-Eyes', 'Atlantis, City of the Sea Dragon'],
          sets: [{ id: 'legend-of-blue-eyes', name: 'Legend of Blue Eyes' }],
        }),
      }
    }

    // The "Zulässigkeit" filter's format menu.
    if (resolvedUrl === '/api/formats') {
      return {
        data: ref({
          items: [
            { id: 'goat', name: 'Goat', isBuiltin: true },
            { id: 'edison', name: 'Edison', isBuiltin: true },
            { id: 'own-1', name: 'Mein Format', isBuiltin: false },
          ],
        }),
        status: ref('success'),
      }
    }

    if (resolvedUrl === '/api/catalog/cards') {
      return {
        data: ref({
          items: catalogState.items ?? [{
            id: 1,
            name: 'Blue-Eyes White Dragon',
            nameDe: 'Blauäugiger w. Drache',
            type: 'Normal Monster',
            frameType: 'normal',
            attribute: 'LIGHT',
            race: 'Dragon',
            level: 8,
            linkval: null,
            atk: 3000,
            def: 2500,
            imageSmall: 'https://img/blue-small.jpg',
          }],
          total: catalogState.total,
          page: 1,
          pageSize: 24,
        }),
        pending: (catalogState.searchPending ??= ref(false)),
        error: ref(null),
        refresh: vi.fn(),
      }
    }

    return {
      data: ref(null),
      pending: ref(false),
      error: ref(null),
    }
  })
})

describe('catalog page', () => {
  it('renders German catalog controls and result tiles', async () => {
    const component = await mountPage()

    expect(component.text()).toContain('Katalog')
    expect(component.find('input[aria-label="Karten suchen"]').exists()).toBe(true)
    // The inventory's filter menus, no native selects left (#63).
    expect(component.find('select').exists()).toBe(false)
    for (const label of ['Typ', 'Attribut', 'Monsterart', 'Stufe/Rang', 'Sortierung']) {
      expect(component.find(`[aria-label="${label}"]`).exists()).toBe(true)
    }
    // German card names by default: the card language follows the interface (ADR 0015).
    expect(component.text()).toContain('Blauäugiger w. Drache')
    expect(component.text()).not.toContain('Blue-Eyes White Dragon')
    // Konami's word on the tile (#101).
    expect(component.text()).toContain('Stufe 8')

    // The set filter used to be a native `<select>` with 1000+ unsearchable
    // options (UX review #5) — now a searchable `USelectMenu`.
    expect(component.find('select[aria-label="Set"]').exists()).toBe(false)
    expect(component.find('[aria-label="Set"]').exists()).toBe(true)
  })

  // Tester feedback, round 15: the count, Deckthema, Format, the two checkboxes and the sort sit on the line at the bottom of the filter panel.
  it('has the count, Deckthema, Format, both checkboxes and the sort in one toolbar, the count first', async () => {
    const component = await mountPage()
    const toolbar = component.find('[data-testid="catalog-toolbar"]')

    expect(toolbar.exists()).toBe(true)
    // The number of cards is at the far left, where the Deckthema menu was.
    expect(toolbar.element.firstElementChild).toBe(toolbar.find('[data-testid="catalog-count"]').element)
    expect(toolbar.find('[data-testid="catalog-count"]').text()).not.toBe('')
    expect(toolbar.find('[aria-label="Deckthema"]').exists()).toBe(true)
    expect(toolbar.find('[aria-label="Format"]').exists()).toBe(true)
    expect(toolbar.text()).toContain('Auch im Kartentext suchen')
    expect(toolbar.text()).toContain('Nur in meinem Inventar suchen')
    expect(toolbar.find('[aria-label="Sortierung"]').exists()).toBe(true)
    // Nothing of it is left above or below the panel.
    expect(component.findAll('[aria-label="Sortierung"]')).toHaveLength(1)
    expect(component.findAll('[data-testid="catalog-count"]')).toHaveLength(1)
  })

  it('shows a Link monster\'s rating on its tile', async () => {
    catalogState.items = [{
      id: 1861629,
      name: 'Decode Talker',
      nameDe: 'Dekodier-Sprecher',
      type: 'Link Monster',
      frameType: 'link',
      attribute: 'DARK',
      race: 'Cyberse',
      level: null,
      linkval: 3,
      atk: 2300,
      def: null,
      imageSmall: null,
    }]
    const component = await mountPage()

    expect(component.text()).toContain('Dekodier-Sprecher')
    expect(component.text()).toContain('Link 3')
  })

  it('reads the facet filters from a deep link (#63)', async () => {
    const component = await mountPage({ route: '/catalog?attribute=LIGHT&level=8' })

    expect(lastQuery('/api/catalog/cards')).toMatchObject({ attribute: 'LIGHT', level: '8' })
    // The triggers show the selection in the card language; the value stays English.
    expect(component.find('[aria-label="Attribut"]').text()).toContain('LICHT')
    expect(component.find('[aria-label="Stufe/Rang"]').text()).toContain('Stufe/Rang 8')
  })

  it('writes a multi-selection as a comma list; reset clears it (#63)', async () => {
    const component = await mountPage()
    const route = useRouter().currentRoute

    component.findComponent(CardFacetFilters).vm.$emit('update:attribute', ['LIGHT', 'DARK'])
    await vi.waitFor(() => {
      expect(route.value.query.attribute).toBe('LIGHT,DARK')
    })
    expect(lastQuery('/api/catalog/cards')).toMatchObject({ attribute: 'LIGHT,DARK', page: 1 })

    const reset = component.findAll('button').find(btn => btn.text() === 'Zurücksetzen')
    await reset!.trigger('click')
    await vi.waitFor(() => {
      expect(route.value.query.attribute).toBeUndefined()
    })
    expect(lastQuery('/api/catalog/cards').attribute).toBeUndefined()
    expect(component.findComponent(CardFacetFilters).props('attribute')).toEqual([])
  })

  it('writes the sort to the URL (#63)', async () => {
    const component = await mountPage()
    const route = useRouter().currentRoute

    // One sort for every card list (round 16): a field in a menu and a small button for the direction.
    const sort = selectWithOption(component.findAllComponents(USelect), 'release')
    expect(sort).toBeTruthy()
    expect(sort!.props('modelValue')).toBe('name')
    await sort!.setValue('atk')
    await vi.waitFor(() => {
      expect(route.value.query.sort).toBe('atk')
    })
    expect(lastQuery('/api/catalog/cards')).toMatchObject({ sort: 'atk' })

    // The button flips the direction and keeps the field.
    await component.find('[data-testid="card-sort-direction"]').trigger('click')
    await vi.waitFor(() => {
      expect(route.value.query.sort).toBe('-atk')
    })
    expect(lastQuery('/api/catalog/cards')).toMatchObject({ sort: '-atk' })
  })

  it('offers the seven fields: release date, ATK, DEF, level, name, card type, pendulum scale', async () => {
    const component = await mountPage()
    const sort = selectWithOption(component.findAllComponents(USelect), 'release')!

    expect((sort.props('items') as Array<{ label: string }>).map(item => item.label)).toEqual([
      'Erscheinungsdatum', 'Angriff', 'Defensive', 'Stufe', 'Name', 'Kartentyp', 'Pendelbereich',
    ])
  })

  it('reads an older sort link: "newest" is the release date, newest first', async () => {
    const component = await mountPage({ route: '/catalog?sort=newest' })
    const sort = selectWithOption(component.findAllComponents(USelect), 'release')!

    expect(sort.props('modelValue')).toBe('release')
    expect(lastQuery('/api/catalog/cards')).toMatchObject({ sort: '-release' })
    expect(component.find('[data-testid="card-sort-direction"]').attributes('aria-label')).toBe('Absteigend')
  })

  // "Auch im Kartentext suchen" (owner feedback in #148): the server already
  // takes `inText`; the page sends it only with a search text and keeps it in the URL.
  it('reads "Auch im Kartentext suchen" from a deep link', async () => {
    const component = await mountPage({ route: '/catalog?q=Hexer&inText=1' })

    expect(lastQuery('/api/catalog/cards')).toMatchObject({ q: 'Hexer', inText: 1 })
    const checkbox = component.find('[role="checkbox"]')
    expect(checkbox.attributes('aria-checked')).toBe('true')
    expect(component.text()).toContain('Auch im Kartentext suchen')
  })

  it('writes "Auch im Kartentext suchen" to the URL and goes back to page 1', async () => {
    const component = await mountPage({ route: '/catalog?q=Hexer&page=3' })
    const route = useRouter().currentRoute
    expect(lastQuery('/api/catalog/cards')).toMatchObject({ q: 'Hexer', page: 3 })
    expect(lastQuery('/api/catalog/cards').inText).toBeUndefined()

    await component.find('[role="checkbox"]').trigger('click')
    await vi.waitFor(() => {
      expect(route.value.query.inText).toBe('1')
    })
    expect(route.value.query.page).toBeUndefined()
    expect(lastQuery('/api/catalog/cards')).toMatchObject({ q: 'Hexer', inText: 1, page: 1 })
  })

  it('keeps "Auch im Kartentext suchen" in the URL without a search text, but not in the query; reset clears it', async () => {
    const component = await mountPage()
    const route = useRouter().currentRoute

    await component.find('[role="checkbox"]').trigger('click')
    await vi.waitFor(() => {
      expect(route.value.query.inText).toBe('1')
    })
    // Without a search text it would change nothing, so the grid isn't refetched.
    expect(lastQuery('/api/catalog/cards').inText).toBeUndefined()

    const reset = component.findAll('button').find(btn => btn.text() === 'Zurücksetzen')
    await reset!.trigger('click')
    await vi.waitFor(() => {
      expect(route.value.query.inText).toBeUndefined()
    })
    expect(component.find('[role="checkbox"]').attributes('aria-checked')).toBe('false')
  })

  // Tester feedback, round 12: "Gib mir da auch die Möglichkeit, nur in meinem Inventar zu suchen."
  it('has "Nur in meinem Inventar suchen": the URL has it, the query sends it, reset clears it', async () => {
    const component = await mountPage()
    const route = useRouter().currentRoute
    const checkboxes = () => component.findAll('[role="checkbox"]')
    expect(component.text()).toContain('Nur in meinem Inventar suchen')
    expect(lastQuery('/api/catalog/cards').owned).toBeUndefined()

    await checkboxes()[1]!.trigger('click')
    await vi.waitFor(() => {
      expect(route.value.query.owned).toBe('1')
    })
    expect(lastQuery('/api/catalog/cards')).toMatchObject({ owned: 1, page: 1 })
    // The text search checkbox is its own.
    expect(route.value.query.inText).toBeUndefined()

    const reset = component.findAll('button').find(btn => btn.text() === 'Zurücksetzen')
    await reset!.trigger('click')
    await vi.waitFor(() => {
      expect(route.value.query.owned).toBeUndefined()
    })
    expect(lastQuery('/api/catalog/cards').owned).toBeUndefined()
    expect(checkboxes()[1]!.attributes('aria-checked')).toBe('false')
  })

  it('reads "Nur in meinem Inventar suchen" and the kinds to leave out from a deep link', async () => {
    const component = await mountPage({ route: '/catalog?owned=1&kind=effect&excludeKind=pendulum,link' })

    expect(lastQuery('/api/catalog/cards')).toMatchObject({ owned: 1, kind: 'effect', excludeKind: 'pendulum,link' })
    expect(component.findAll('[role="checkbox"]')[1]!.attributes('aria-checked')).toBe('true')
    const menu = component.find('[aria-label="Ohne Kartenart"]')
    expect(menu.exists()).toBe(true)
    expect(menu.text()).toContain('Pendel')
    expect(menu.text()).toContain('Link')
  })

  it('writes the kinds to leave out as a comma list and goes back to page 1', async () => {
    const component = await mountPage({ route: '/catalog?page=3' })
    const route = useRouter().currentRoute

    component.findComponent(CardFacetFilters).vm.$emit('update:excludeKind', ['pendulum', 'token'])
    await vi.waitFor(() => {
      expect(route.value.query.excludeKind).toBe('pendulum,token')
    })
    expect(route.value.query.page).toBeUndefined()
    expect(lastQuery('/api/catalog/cards')).toMatchObject({ excludeKind: 'pendulum,token', page: 1 })
  })

  // Tester feedback, round 14: "bau beim Inventar und beim Katalog die Filter-Option Format-Zulässigkeit" and
  // "auch die Option, nach Deckthemen zu filtern".
  describe('the format legality and the Deckthema filter', () => {
    it('has both: a Format menu, and a Deckthema menu with the archetypes of the catalog', async () => {
      const component = await mountPage()

      expect(component.find('[aria-label="Format"]').exists()).toBe(true)
      expect(component.find('[aria-label="Deckthema"]').exists()).toBe(true)
      // The "Zulässigkeit" menu waits for a format.
      expect(component.find('[aria-label="Zulässigkeit"]').exists()).toBe(false)
    })

    it('writes a picked format and what to show of it to the URL and the query; the default is not written', async () => {
      const component = await mountPage()
      const route = useRouter().currentRoute
      const filter = component.findComponent({ name: 'CardFormatFilter' })

      filter.vm.$emit('update:formatId', 'goat')
      await vi.waitFor(() => {
        expect(route.value.query.formatId).toBe('goat')
      })
      expect(route.value.query.legality).toBeUndefined()
      expect(lastQuery('/api/catalog/cards')).toMatchObject({ formatId: 'goat', legality: 'legal', page: 1 })
      expect(component.find('[aria-label="Zulässigkeit"]').exists()).toBe(true)

      filter.vm.$emit('update:legality', 'limited')
      await vi.waitFor(() => {
        expect(route.value.query.legality).toBe('limited')
      })
      expect(lastQuery('/api/catalog/cards')).toMatchObject({ formatId: 'goat', legality: 'limited' })
    })

    it('reads them from a deep link, and reset clears them', async () => {
      const component = await mountPage({ route: '/catalog?formatId=edison&legality=illegal&archetype=Blue-Eyes' })
      const route = useRouter().currentRoute

      expect(lastQuery('/api/catalog/cards')).toMatchObject({ formatId: 'edison', legality: 'illegal', archetype: ['Blue-Eyes'] })
      expect(component.find('[aria-label="Format"]').text()).toContain('Edison')
      expect(component.find('[aria-label="Zulässigkeit"]').text()).toContain('Nicht zulässig')
      // The filter value is the English name of the archetype, the menu shows it in the card language (round 15).
      expect(component.find('[aria-label="Deckthema"]').text()).toContain('Blauäugig')

      const reset = component.findAll('button').find(btn => btn.text() === 'Zurücksetzen')
      await reset!.trigger('click')
      await vi.waitFor(() => {
        expect(route.value.query.formatId).toBeUndefined()
      })
      expect(route.value.query.legality).toBeUndefined()
      expect(route.value.query.archetype).toBeUndefined()
      const query = lastQuery('/api/catalog/cards')
      expect(query.formatId).toBeUndefined()
      expect(query.legality).toBeUndefined()
      expect(query.archetype).toBeUndefined()
    })

    it('ignores a legality it does not know', async () => {
      await mountPage({ route: '/catalog?formatId=goat&legality=banned' })
      expect(lastQuery('/api/catalog/cards')).toMatchObject({ formatId: 'goat', legality: 'legal' })
    })

    it('drops a format that is not in the list any more (deleted, or someone else\'s)', async () => {
      await mountPage({ route: '/catalog?formatId=gone-format' })
      const route = useRouter().currentRoute

      await vi.waitFor(() => {
        expect(route.value.query.formatId).toBeUndefined()
      })
      expect(lastQuery('/api/catalog/cards').formatId).toBeUndefined()
    })

    it('sends the themes as repeated keys, and keeps a comma in a name', async () => {
      const component = await mountPage()
      const route = useRouter().currentRoute

      component.findComponent({ name: 'CardArchetypeFilter' }).vm.$emit('update:modelValue', ['Blue-Eyes', 'Atlantis, City of the Sea Dragon'])
      await vi.waitFor(() => {
        expect(route.value.query.archetype).toEqual(['Blue-Eyes', 'Atlantis, City of the Sea Dragon'])
      })
      expect(lastQuery('/api/catalog/cards')).toMatchObject({ archetype: ['Blue-Eyes', 'Atlantis, City of the Sea Dragon'], page: 1 })
    })

    it('counts as a filter: the empty result says "no matches"', async () => {
      catalogState.total = 0
      catalogState.items = []
      const component = await mountPage({ route: '/catalog?formatId=goat&legality=illegal' })
      expect(component.text()).toContain('Keine Karten gefunden')
    })
  })

  it('opens the add-to-inventory modal pre-filled with the clicked card (#6)', async () => {
    const component = await mountPage()

    const addButton = component.findAll('button').find(btn => btn.text() === 'Zum Inventar')
    expect(addButton).toBeTruthy()
    await addButton!.trigger('click')

    expect(body().text()).toContain('Karte hinzufügen')
    expect(body().text()).toContain('Blauäugiger w. Drache')
    expect(body().text()).toContain('Anzahl')
    expect(body().text()).toContain('Sammlung')
    // No collector details since ADR 0017.
    expect(body().text()).not.toContain('Drucksprache')
  })

  it('keeps a wishlist toggle that finishes while the grid reloads (#98)', async () => {
    const component = await mountPage()
    let finish!: () => void
    vi.stubGlobal('$fetch', vi.fn(() => new Promise<void>((resolve) => {
      finish = resolve
    })))

    const wishlistButton = component.findAll('button').find(btn => btn.text() === 'Zur Wunschliste')
    await wishlistButton!.trigger('click')

    // A new search starts: the previous grid stays, dimmed (#148)…
    catalogState.searchPending!.value = true
    await nextTick()
    const results = component.find('[data-testid="catalog-results"]')
    expect(results.attributes('aria-busy')).toBe('true')
    expect(results.classes()).toContain('opacity-50')
    expect(component.text()).toContain('Blauäugiger w. Drache')
    expect(component.text()).toContain('Zur Wunschliste')

    // …the toggle finishes meanwhile, and the new grid shows it.
    finish()
    await flushPromises()
    catalogState.searchPending!.value = false
    await nextTick()
    expect(component.text()).toContain('Auf der Wunschliste')
    expect(component.find('[data-testid="catalog-results"]').attributes('aria-busy')).toBeUndefined()
    expect(component.find('[data-testid="catalog-results"]').classes()).not.toContain('opacity-50')
  })

  it('shows skeletons only while the very first search loads (#148)', async () => {
    catalogState.searchPending = ref(true)
    const component = await mountPage()

    expect(component.text()).not.toContain('Blauäugiger w. Drache')
    expect(component.find('[data-testid="catalog-results"]').exists()).toBe(false)
    expect(component.findAll('[data-slot="base"].animate-pulse, .animate-pulse').length).toBeGreaterThanOrEqual(12)
  })

  it('pushes a history entry when a tile opens the card (#148)', async () => {
    const component = await mountPage()
    const push = vi.spyOn(useRouter(), 'push')
    try {
      const tileButton = component.findAll('button').find(btn => btn.text() === 'Blauäugiger w. Drache')
      await tileButton!.trigger('click')

      expect(push).toHaveBeenCalledWith({ query: expect.objectContaining({ card: '1' }) })
    }
    finally {
      push.mockRestore()
    }
  })

  it('drops `?card=` with a replace when a deep-linked overlay closes (#148)', async () => {
    const component = await openDetail(cardDetail())
    const route = useRouter().currentRoute
    const back = vi.spyOn(useRouter(), 'back')
    try {
      expect(route.value.query.card).toBe('1')

      component.findComponent(CardDetailModal).vm.$emit('update:open', false)
      await vi.waitFor(() => {
        expect(route.value.query.card).toBeUndefined()
      })
      expect(route.value.path).toBe('/catalog')
      // The previous entry isn't this catalog view without the card.
      expect(back).not.toHaveBeenCalled()
    }
    finally {
      back.mockRestore()
    }
  })

  it('replaces the entry when an alias passcode resolves to its canonical card (ADR 0024)', async () => {
    const component = await openDetail(cardDetail())
    // Card 2 loads as itself (the stub above answers card 1 for every id).
    const detail = cardDetail()
    vi.stubGlobal('$fetch', vi.fn((url: string) => Promise.resolve({
      ...detail,
      card: { ...detail.card, id: Number(url.split('/').pop()) },
    })))
    const replace = vi.spyOn(useRouter(), 'replace')
    const push = vi.spyOn(useRouter(), 'push')
    try {
      component.findComponent(CardDetailModal).vm.$emit('resolved', 2)
      await vi.waitFor(() => {
        expect(useRouter().currentRoute.value.query.card).toBe('2')
      })
      expect(replace).toHaveBeenCalledWith({ query: expect.objectContaining({ card: '2' }) })
      expect(push).not.toHaveBeenCalled()
    }
    finally {
      replace.mockRestore()
      push.mockRestore()
    }
  })

  it('offers "Zum Deck" in the card detail (#148)', async () => {
    await openDetail(cardDetail())

    const dialog = body().find('[role="dialog"]')
    const buttons = dialog.findAll('button').map(button => button.text())
    expect(buttons).toContain('Zum Deck')
    // After "Zum Inventar", before the wishlist toggle.
    expect(buttons.indexOf('Zum Deck')).toBeGreaterThan(buttons.indexOf('Zum Inventar'))
    expect(buttons.indexOf('Zum Deck')).toBeLessThan(buttons.indexOf('Zur Wunschliste'))
  })

  it('shows the result count with a thousands separator and the right plural', async () => {
    const one = await mountPage()
    expect(one.text()).toContain('1 Karte')
    expect(one.text()).not.toContain('1 Karten')

    catalogState.total = 13_000
    const many = await mountPage()
    expect(many.text()).toContain('13.000 Karten')
  })

  it('renders in English', async () => {
    await setTestLocale('en')
    catalogState.total = 13_000
    const component = await mountPage()

    const text = component.text()
    expect(text).toContain('Catalog')
    expect(text).toContain('13,000 cards')
    expect(text).toContain('Add to inventory')
    expect(text).toContain('Add to wishlist')
    expect(text).toContain('Level 8')
    expect(text).toContain('Blue-Eyes White Dragon')
    expect(text).not.toContain('Blauäugig')
    expect(component.find('input[aria-label="Search cards"]').exists()).toBe(true)
    expect(text).toContain('Also search card text')
    expect(component.find('[aria-label="Type"]').exists()).toBe(true)
    expect(component.find('[aria-label="Sort by"]').exists()).toBe(true)
    expect(text).not.toContain('Karten')
    expect(text).not.toContain('Zum Inventar')

    const addButton = component.findAll('button').find(btn => btn.text() === 'Add to inventory')
    await addButton!.trigger('click')

    const modal = body().text()
    expect(modal).toContain('Add card')
    expect(modal).toContain('Quantity')
    expect(modal).toContain('Collection')
    expect(modal).not.toContain('Anzahl')
  })

  it('shows English card names in a German interface when the profile says so', async () => {
    useState('card-locale-choice').value = 'en'
    const component = await mountPage()

    expect(component.text()).toContain('Katalog')
    expect(component.text()).toContain('Blue-Eyes White Dragon')
    expect(component.text()).not.toContain('Blauäugig')
  })

  it('shows the German name, the English name, the German text and no source credit in the detail', async () => {
    await openDetail(cardDetail())
    const detail = body().text()

    expect(detail).toContain('Blauäugiger w. Drache')
    expect(detail).toContain('Englisch: Blue-Eyes White Dragon')
    expect(detail).toContain('Dieser legendäre Drache')
    expect(detail).not.toContain('powerful engine')
    // No source credit in the UI (#87, ADR 0017); the README names the source.
    expect(detail).not.toContain('Deutsche Kartentexte')
    expect(body().find('a[href*="yugioh-card-history"]').exists()).toBe(false)
  })

  it('shows the printings and the actions in the detail; "Zum Inventar" opens the add dialog on top (#88)', async () => {
    await openDetail(cardDetail({}, [{ setCode: 'LOB-001', setName: 'Legend of Blue Eyes White Dragon', rarity: 'Ultra Rare', price: null }]))

    const dialog = body().find('[role="dialog"]')
    expect(dialog.find('h2').text()).toBe('Blauäugiger w. Drache')
    expect(dialog.text()).toContain('Printings')
    expect(dialog.text()).toContain('Legend of Blue Eyes White Dragon')
    expect(dialog.text()).toMatch(/LOB-001\s*·\s*Ultra Rare/)
    expect(dialog.text()).toContain('Zur Wunschliste')

    const addButton = dialog.findAll('button').find(btn => btn.text() === 'Zum Inventar')
    expect(addButton).toBeTruthy()
    await addButton!.trigger('click')

    await vi.waitFor(() => {
      expect(body().findAll('[role="dialog"]')).toHaveLength(2)
    })
    const addDialog = body().findAll('[role="dialog"]')[1]!
    expect(addDialog.text()).toContain('Karte hinzufügen')
    expect(addDialog.text()).toContain('Blauäugiger w. Drache')
  })

  it('falls back to the English text with a hint when a card has no German data', async () => {
    await openDetail(cardDetail({ nameDe: null, descDe: null }))
    const detail = body().text()

    expect(detail).toContain('Blue-Eyes White Dragon')
    expect(detail).not.toContain('Englisch:')
    expect(detail).toContain('powerful engine')
    expect(detail).toContain('Für diese Karte gibt es keinen deutschen Kartentext.')
    expect(detail).not.toContain('Deutsche Kartentexte')
  })

  it('shows only English in the detail in English', async () => {
    await setTestLocale('en')
    await openDetail(cardDetail())
    const detail = body().text()

    expect(detail).toContain('Blue-Eyes White Dragon')
    expect(detail).toContain('powerful engine')
    expect(detail).not.toContain('Blauäugig')
    expect(detail).not.toContain('English:')
    expect(detail).not.toContain('German card texts')
  })
})
