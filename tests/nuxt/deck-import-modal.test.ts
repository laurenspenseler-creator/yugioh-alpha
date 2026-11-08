import { mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import DeckImportModal from '~/components/decks/DeckImportModal.vue'
import { setTestLocale } from './fixtures/locale'

// "Deck importieren" creates a deck from a list; with a `deckId` the same dialog adds the list to a deck that exists
// (tester feedback, round 10: "Lass mich bei bereits erstellten Decks auch Listen hinzufügen").

const DARK_MAGICIAN = 46986414

const preview = {
  format: 'text',
  cover: null,
  sections: {
    main: [{
      input: { raw: '3 Dark Magician', quantity: 3, query: 'Dark Magician' },
      candidates: [{ cardId: DARK_MAGICIAN, name: 'Dark Magician', nameDe: null, type: 'Normal Monster', frameType: 'normal', imageSmall: null, score: 1, matchedBy: 'exact' }],
    }],
    extra: [],
    side: [],
  },
}

type Call = [string, { method?: string, body?: Record<string, unknown> }?]

function stubFetch(answers: Record<string, unknown> = {}) {
  const fetchMock = vi.fn(async (url: string, _options?: Call[1]) => {
    if (url in answers) {
      const answer = answers[url]
      if (answer instanceof Error) {
        throw answer
      }
      return answer
    }
    if (url === '/api/decks/import/preview') {
      return preview
    }
    if (url === '/api/formats') {
      return { items: [] }
    }
    return {}
  })
  vi.stubGlobal('$fetch', fetchMock)
  return fetchMock
}

const callsTo = (fetchMock: ReturnType<typeof stubFetch>, url: string) => (fetchMock.mock.calls as unknown as Call[]).filter(call => call[0] === url)
const bodyText = () => document.body.textContent ?? ''
const button = (label: string) => [...document.querySelectorAll('button')].find(element => element.textContent?.includes(label))

async function typeList(text: string) {
  const textarea = document.querySelector<HTMLTextAreaElement>('textarea[name="decklist"]')!
  textarea.value = text
  textarea.dispatchEvent(new Event('input', { bubbles: true }))
  await flushPromises()
}

async function reviewList() {
  await typeList('3 Dark Magician')
  button('Deckliste prüfen')!.click()
  await vi.waitFor(() => expect(button('Zurück')).toBeDefined())
}

afterEach(async () => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
  await setTestLocale('de')
})

enableAutoUnmount(afterEach)

describe('the deck import dialog, adding to a deck that exists', () => {
  it('asks for the list like "Deck importieren", but says it goes into the deck', async () => {
    stubFetch()
    await mountSuspended(DeckImportModal, { props: { open: true, deckId: 'deck-1' } })

    expect(bodyText()).toContain('Liste zum Deck hinzufügen')
    expect(bodyText()).not.toContain('Deck importieren')
    expect(document.querySelector('textarea[name="decklist"]')).not.toBeNull()
  })

  it('reviews the cards without a name and a format to choose, and adds them to the deck', async () => {
    const fetchMock = stubFetch()
    const component = await mountSuspended(DeckImportModal, { props: { open: true, deckId: 'deck-1' } })

    await reviewList()

    // The deck has its name and its format already.
    expect(document.querySelector('input[name="name"]')).toBeNull()
    expect(bodyText()).not.toContain('Format (optional)')
    expect(bodyText()).toContain('Dark Magician')
    expect(button('Deck anlegen')).toBeUndefined()

    button('Zum Deck hinzufügen')!.click()
    await vi.waitFor(() => expect(component.emitted('added')).toHaveLength(1))

    const added = callsTo(fetchMock, '/api/decks/deck-1/cards/import')
    expect(added).toHaveLength(1)
    expect(added[0]![1]).toMatchObject({
      method: 'POST',
      body: { cards: [{ catalog_card_id: DARK_MAGICIAN, section: 'main', quantity: 3 }] },
    })
    expect(component.emitted('added')![0]).toEqual([{ copies: 3 }])
    expect(component.emitted('update:open')!.at(-1)).toEqual([false])
    // No new deck is created.
    expect(callsTo(fetchMock, '/api/decks')).toHaveLength(0)
  })

  it('says so when the list could not be added, and keeps the dialog open', async () => {
    const failure = Object.assign(new Error('boom'), { statusCode: 500 })
    const fetchMock = stubFetch({ '/api/decks/deck-1/cards/import': failure })
    const component = await mountSuspended(DeckImportModal, { props: { open: true, deckId: 'deck-1' } })

    await reviewList()
    button('Zum Deck hinzufügen')!.click()
    await vi.waitFor(() => expect(bodyText()).toContain('Die Liste konnte nicht zum Deck hinzugefügt werden.'))

    expect(callsTo(fetchMock, '/api/decks/deck-1/cards/import')).toHaveLength(1)
    expect(component.emitted('added')).toBeUndefined()
    expect(component.emitted('update:open')).toBeUndefined()
  })

  it('still creates a new deck without a deckId, with a name and a format', async () => {
    const fetchMock = stubFetch({ '/api/decks': { id: 'new-deck' } })
    const component = await mountSuspended(DeckImportModal, { props: { open: true } })

    expect(bodyText()).toContain('Deck importieren')
    await reviewList()

    expect(document.querySelector('input[name="name"]')).not.toBeNull()
    expect(bodyText()).toContain('Format (optional)')
    expect(button('Zum Deck hinzufügen')).toBeUndefined()

    button('Deck anlegen')!.click()
    await vi.waitFor(() => expect(component.emitted('created')).toHaveLength(1))

    expect(callsTo(fetchMock, '/api/decks')[0]![1]).toMatchObject({
      method: 'POST',
      body: { cards: [{ catalog_card_id: DARK_MAGICIAN, section: 'main', quantity: 3 }] },
    })
    expect(component.emitted('added')).toBeUndefined()
  })
})
