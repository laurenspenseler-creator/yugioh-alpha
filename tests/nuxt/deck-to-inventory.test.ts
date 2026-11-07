import { afterEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import DeckToInventoryButton from '~/components/decks/DeckToInventoryButton.vue'

enableAutoUnmount(afterEach)

afterEach(() => {
  vi.unstubAllGlobals()
})

const rows = [
  // Owned 2 of 3 in Main, plus one more in Side: 4 copies in the deck, 2 missing.
  { catalogCardId: 100, quantity: 3, owned: 2 },
  { catalogCardId: 100, quantity: 1, owned: 2 },
  // Fully owned.
  { catalogCardId: 200, quantity: 2, owned: 5 },
  // Not owned at all.
  { catalogCardId: 300, quantity: 1, owned: 0 },
]

function fetchMock() {
  return vi.fn(async (url: string, _options?: unknown) => {
    if (url === '/api/collections') {
      return { items: [{ id: 'box-1', name: 'Box 1' }], allCount: 0 }
    }
    return { created: 1, merged: 1, items: [] }
  })
}

function buttonByText(text: string): HTMLButtonElement | undefined {
  return [...document.body.querySelectorAll('button')].find(button => button.textContent?.includes(text)) as HTMLButtonElement | undefined
}

describe('adding a deck to the inventory', () => {
  it('is disabled for an empty deck', async () => {
    const component = await mountSuspended(DeckToInventoryButton, { props: { rows: [] } })

    expect(component.find('button').attributes('disabled')).toBeDefined()
  })

  it('offers the missing copies first and sends exactly those to the bulk endpoint', async () => {
    const fetchSpy = fetchMock()
    vi.stubGlobal('$fetch', fetchSpy)
    const component = await mountSuspended(DeckToInventoryButton, { props: { rows } })

    await component.find('button').trigger('click')
    await flushPromises()
    expect(document.body.textContent).toContain('3 Exemplare fehlen')

    buttonByText('Übernehmen')!.click()
    await flushPromises()

    const bulk = fetchSpy.mock.calls.find(call => call[0] === '/api/inventory/bulk')!
    expect(bulk[1]).toMatchObject({ method: 'POST' })
    expect((bulk[1] as { body: { items: unknown[] } }).body.items).toEqual([
      { catalog_card_id: 100, quantity: 2, collection_id: null },
      { catalog_card_id: 300, quantity: 1, collection_id: null },
    ])
    expect(component.emitted('added')).toHaveLength(1)
  })

  it('can add every copy of the deck instead', async () => {
    const fetchSpy = fetchMock()
    vi.stubGlobal('$fetch', fetchSpy)
    const component = await mountSuspended(DeckToInventoryButton, { props: { rows } })

    await component.find('button').trigger('click')
    await flushPromises()
    const all = [...document.body.querySelectorAll('input[type="radio"]')].find(input => (input as HTMLInputElement).value === 'all') as HTMLInputElement
    all.click()
    await flushPromises()
    buttonByText('Übernehmen')!.click()
    await flushPromises()

    const bulk = fetchSpy.mock.calls.find(call => call[0] === '/api/inventory/bulk')!
    expect((bulk[1] as { body: { items: unknown[] } }).body.items).toEqual([
      { catalog_card_id: 100, quantity: 4, collection_id: null },
      { catalog_card_id: 200, quantity: 2, collection_id: null },
      { catalog_card_id: 300, quantity: 1, collection_id: null },
    ])
  })

  it('says so when every card is already in the inventory and keeps the missing option off', async () => {
    vi.stubGlobal('$fetch', fetchMock())
    const component = await mountSuspended(DeckToInventoryButton, { props: { rows: [{ catalogCardId: 1, quantity: 2, owned: 2 }] } })

    await component.find('button').trigger('click')
    await flushPromises()

    expect(document.body.textContent).toContain('Alle Karten des Decks sind schon im Inventar.')
  })
})
