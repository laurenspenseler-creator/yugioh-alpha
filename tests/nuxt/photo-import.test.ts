// "Fotos auswerten": the printed names and the artwork are looked at together (ADR 0040, 0041).
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PhotoImport from '~/components/cards/PhotoImport.vue'

const readPhotoLines = vi.fn()
const recognizeArt = vi.fn()
vi.mock('~/utils/photo-ocr', () => ({ readPhotoLines: (...args: unknown[]) => readPhotoLines(...args) }))
vi.mock('~/utils/art-vision', () => ({ recognizeArt: (...args: unknown[]) => recognizeArt(...args) }))

const PASSES = [[{ text: 'KURIBOH', heights: [2] }]]
const ART = { cards: [{ cardId: 40640057, similarity: 0.8, margin: 0.2, copies: 1, support: 6, sure: true }], rotation: 0, windows: 100, seconds: 9 }

function photo(name = 'cards.jpg') {
  return new File(['x'], name, { type: 'image/jpeg' })
}

async function choose(component: Awaited<ReturnType<typeof mountSuspended>>, files: File[]) {
  const input = component.find('input[type="file"][multiple]')
  Object.defineProperty(input.element, 'files', { value: files, configurable: true })
  await input.trigger('change')
  await flushPromises()
}

describe('PhotoImport', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    readPhotoLines.mockReset().mockResolvedValue(PASSES)
    recognizeArt.mockReset().mockResolvedValue(ART)
    fetchMock.mockReset().mockResolvedValue({
      matches: [
        { cardId: 40640057, name: 'Kuriboh', text: 'KURIBOH', score: 0.95, count: 1, source: 'both' },
        { cardId: 46986414, name: 'Dark Magician', text: 'Dark Magician', score: 0.9, count: 2, source: 'art' },
        { cardId: 15025844, name: 'Mystical Elf', text: 'Mystic Elf', score: 0.7, count: 1, source: 'text' },
      ],
    })
    vi.stubGlobal('$fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reads the names and recognizes the artwork, sends both to the server and turns the answer into card lines', async () => {
    const component = await mountSuspended(PhotoImport)

    await choose(component, [photo()])

    expect(readPhotoLines).toHaveBeenCalledTimes(1)
    expect(recognizeArt).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('/api/cards/match-fragments', { method: 'POST', body: { passes: PASSES, art: ART.cards } })
    // A sure card goes in by its catalog name, a doubtful one as it was read.
    expect(component.emitted('lines')).toEqual([[{ lines: ['2x Dark Magician', '1x Kuriboh', '1x Mystic Elf'], photos: 1, unsure: 1 }]])
  })

  it('goes on with the names alone when the artwork cannot be recognized (no index in this build, say)', async () => {
    recognizeArt.mockRejectedValue(new Error('The artwork index answered 404'))
    const component = await mountSuspended(PhotoImport)

    await choose(component, [photo()])

    expect(fetchMock).toHaveBeenCalledWith('/api/cards/match-fragments', { method: 'POST', body: { passes: PASSES, art: [] } })
    expect(component.emitted('lines')).toHaveLength(1)
  })

  it('goes on with the artwork alone when the names cannot be read', async () => {
    readPhotoLines.mockRejectedValue(new Error('no worker'))
    const component = await mountSuspended(PhotoImport)

    await choose(component, [photo()])

    expect(fetchMock).toHaveBeenCalledWith('/api/cards/match-fragments', { method: 'POST', body: { passes: [], art: ART.cards } })
    expect(component.emitted('lines')).toHaveLength(1)
  })

  it('says it failed when neither works, and adds no lines', async () => {
    readPhotoLines.mockRejectedValue(new Error('no worker'))
    recognizeArt.mockRejectedValue(new Error('no worker either'))
    const component = await mountSuspended(PhotoImport)

    await choose(component, [photo()])

    expect(fetchMock).not.toHaveBeenCalled()
    expect(component.emitted('lines')).toBeUndefined()
    expect(component.find('[role="alert"]').text()).toContain('konnten nicht ausgewertet werden')
  })

  it('adds up the copies of a card on several photos', async () => {
    const component = await mountSuspended(PhotoImport)

    await choose(component, [photo('a.jpg'), photo('b.jpg')])

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(component.emitted('lines')).toEqual([[{ lines: ['4x Dark Magician', '2x Kuriboh', '2x Mystic Elf'], photos: 2, unsure: 1 }]])
  })
})
