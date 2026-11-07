import { afterEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import WishlistImportModal from '~/components/wishlist/WishlistImportModal.vue'
import type { EntryCandidate, EntrySuggestResult } from '~/utils/card-entry'

enableAutoUnmount(afterEach)

afterEach(() => {
  vi.unstubAllGlobals()
})

function candidate(cardId: number, name: string, patch: Partial<EntryCandidate> = {}): EntryCandidate {
  return { cardId, name, nameDe: null, type: 'Normal Monster', frameType: null, imageSmall: null, score: 1, matchedBy: 'exact', ...patch }
}

const results: EntrySuggestResult[] = [
  { input: { raw: '3x Dark Magician', quantity: 3, query: 'Dark Magician' }, candidates: [candidate(1, 'Dark Magician')] },
  // Already on the wishlist.
  { input: { raw: 'Pot of Greed', quantity: 1, query: 'Pot of Greed' }, candidates: [candidate(2, 'Pot of Greed')] },
  // Not clear: two cards that fit, none chosen yet.
  {
    input: { raw: 'Kuriboh', quantity: 1, query: 'Kuriboh' },
    candidates: [candidate(3, 'Kuriboh', { score: 0.6, matchedBy: 'fuzzy' }), candidate(4, 'Winged Kuriboh', { score: 0.5, matchedBy: 'fuzzy' })],
  },
  { input: { raw: 'Nothing at all', quantity: 1, query: 'Nothing at all' }, candidates: [] },
]

function fetchMock() {
  return vi.fn(async (url: string, _options?: unknown) => {
    if (url === '/api/inventory/entry/suggest') {
      return { results }
    }
    if (url === '/api/wishlist/ids') {
      return { ids: [2] }
    }
    return {}
  })
}

function buttonByText(text: string): HTMLButtonElement {
  const button = [...document.body.querySelectorAll('button')].find(candidateButton => candidateButton.textContent?.includes(text))
  if (!button) {
    throw new Error(`no button "${text}"`)
  }
  return button as HTMLButtonElement
}

async function typeList(text: string) {
  const textarea = document.body.querySelector('textarea')!
  textarea.value = text
  textarea.dispatchEvent(new Event('input', { bubbles: true }))
  await flushPromises()
}

describe('adding cards to the wishlist from a list', () => {
  it('shows what was recognised and adds only the clear cards that are not on the wishlist yet', async () => {
    const fetchSpy = fetchMock()
    vi.stubGlobal('$fetch', fetchSpy)
    const component = await mountSuspended(WishlistImportModal, { props: { open: true } })

    await typeList('3x Dark Magician\nPot of Greed\nKuriboh\nNothing at all')
    buttonByText('Prüfen').click()
    await flushPromises()

    const body = document.body.textContent ?? ''
    expect(body).toContain('Dark Magician')
    expect(body).toContain('schon auf der Wunschliste')
    expect(body).toContain('kein Treffer')
    expect(body).toContain('Neu auf der Wunschliste: 1 · schon drauf: 1 · nicht übernommen: 2')

    buttonByText('Zur Wunschliste hinzufügen').click()
    await flushPromises()

    const posts = fetchSpy.mock.calls.filter(call => call[0] === '/api/wishlist')
    expect(posts).toHaveLength(1)
    expect(posts[0]![1]).toMatchObject({ method: 'POST', body: { catalogCardId: 1, quantity: 3 } })
    expect(component.emitted('added')).toHaveLength(1)
  })

  it('asks for a card first and does not call the server for an empty list', async () => {
    const fetchSpy = fetchMock()
    vi.stubGlobal('$fetch', fetchSpy)
    await mountSuspended(WishlistImportModal, { props: { open: true } })

    buttonByText('Prüfen').click()
    await flushPromises()

    expect(document.body.textContent).toContain('Bitte mindestens eine Karte eintragen.')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('counts a card named twice once, with both amounts', async () => {
    const fetchSpy = vi.fn(async (url: string, _options?: unknown) => {
      if (url === '/api/inventory/entry/suggest') {
        return {
          results: [
            { input: { raw: '2x Kuriboh', quantity: 2, query: 'Kuriboh' }, candidates: [candidate(3, 'Kuriboh')] },
            { input: { raw: 'Kuriboh', quantity: 1, query: 'Kuriboh' }, candidates: [candidate(3, 'Kuriboh')] },
          ],
        }
      }
      return url === '/api/wishlist/ids' ? { ids: [] } : {}
    })
    vi.stubGlobal('$fetch', fetchSpy)
    await mountSuspended(WishlistImportModal, { props: { open: true } })

    await typeList('2x Kuriboh\nKuriboh')
    buttonByText('Prüfen').click()
    await flushPromises()
    buttonByText('Zur Wunschliste hinzufügen').click()
    await flushPromises()

    const posts = fetchSpy.mock.calls.filter(call => call[0] === '/api/wishlist')
    expect(posts).toHaveLength(1)
    expect(posts[0]![1]).toMatchObject({ body: { catalogCardId: 3, quantity: 3 } })
  })
})
