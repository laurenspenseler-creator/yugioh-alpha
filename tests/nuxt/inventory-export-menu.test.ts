// "Exportieren" in the inventory (ADR 0051): the menu fetches the rows of the list's search and hands the file to the browser.
import { strFromU8, unzipSync } from 'fflate'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount } from '@vue/test-utils'
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { createError, defineEventHandler, getQuery } from 'h3'
import { UDropdownMenu } from '#components'
import InventoryExportMenu from '~/components/inventory/InventoryExportMenu.vue'
import { readXlsx } from '~/utils/spreadsheet-list'
import { setTestLocale } from './fixtures/locale'

enableAutoUnmount(afterEach)

afterEach(async () => {
  await setTestLocale('de')
})

const row = (overrides: Record<string, unknown> = {}) => ({
  catalogCardId: 46986414,
  collectionId: 'col-1',
  collectionName: 'Box 1',
  quantity: 3,
  note: null,
  name: 'Dark Magician',
  nameDe: 'Dunkler Magier',
  type: 'Normal Monster',
  attribute: 'DARK',
  race: 'Spellcaster',
  level: 7,
  linkval: null,
  atk: 2500,
  def: 2100,
  ...overrides,
})

interface MenuItem { label: string, onSelect?: () => unknown }

const downloads: Array<{ name: string, blob: Blob }> = []
let requestQuery: Record<string, unknown> = {}
let answer: { items: unknown[], truncated: boolean } | 'error' = { items: [row()], truncated: false }

registerEndpoint('/api/inventory/export', defineEventHandler((event) => {
  requestQuery = getQuery(event)
  if (answer === 'error') {
    throw createError({ statusCode: 500 })
  }
  return answer
}))

beforeEach(() => {
  downloads.length = 0
  requestQuery = {}
  answer = { items: [row(), row({ catalogCardId: 55144522, collectionId: null, collectionName: null, quantity: 1, name: 'Pot of Greed', nameDe: 'Topf der Gier', type: 'Spell Card', attribute: null, race: 'Normal', level: null, atk: null, def: null })], truncated: false }
  useToast().clear()

  let lastBlob: Blob | null = null
  vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
    lastBlob = blob as Blob
    return 'blob:test'
  })
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push({ name: this.download, blob: lastBlob! })
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

async function mountMenu(props: Record<string, unknown> = {}) {
  return mountSuspended(InventoryExportMenu, {
    props: { scope: 'Alle Karten', query: { q: 'dark', kind: 'monster', page: undefined }, filtered: true, ...props },
  })
}

function itemsOf(component: Awaited<ReturnType<typeof mountMenu>>): MenuItem[] {
  const menu = component.findComponent(UDropdownMenu) as unknown as { props: (name: string) => unknown }
  return (menu.props('items') as MenuItem[][]).flat()
}

async function choose(component: Awaited<ReturnType<typeof mountMenu>>, label: string) {
  await itemsOf(component).find(item => item.label === label)!.onSelect!()
}

const toasts = () => useToast().toasts.value.map(toast => `${toast.color}: ${toast.title}`)

describe('the export menu', () => {
  it('offers Excel, Word and text, with a hint that it exports what the list shows', async () => {
    const component = await mountMenu()

    expect(itemsOf(component).map(item => item.label)).toEqual([
      'Exportiert, was die Liste gerade zeigt, auf allen Seiten.',
      'Excel-Tabelle (.xlsx)',
      'Word-Dokument (.docx)',
      'Textliste (.txt)',
    ])
    expect(component.find('[data-testid="inventory-export"]').text()).toContain('Exportieren')
  })

  it('is in English with English files when the interface is', async () => {
    await setTestLocale('en')
    const component = await mountMenu({ scope: 'All cards' })

    expect(itemsOf(component).map(item => item.label)).toContain('Excel table (.xlsx)')
    await choose(component, 'Text list (.txt)')
    expect(downloads[0]!.name).toMatch(/^inventory-all-cards-\d{4}-\d{2}-\d{2}\.txt$/)
    expect(await downloads[0]!.blob.text()).toContain('# Inventory – All cards')
  })

  it('sends the list\'s search and filters to the server, without a page', async () => {
    const component = await mountMenu()
    await choose(component, 'Textliste (.txt)')

    expect(requestQuery).toEqual({ q: 'dark', kind: 'monster' })
  })

  it('downloads an Excel table with the rows in the card language', async () => {
    const component = await mountMenu()
    await choose(component, 'Excel-Tabelle (.xlsx)')

    expect(downloads).toHaveLength(1)
    expect(downloads[0]!.name).toMatch(/^inventar-alle-karten-\d{4}-\d{2}-\d{2}\.xlsx$/)
    expect(downloads[0]!.blob.type).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')

    const rows = readXlsx(new Uint8Array(await downloads[0]!.blob.arrayBuffer()))
    expect(rows[0]).toEqual(expect.arrayContaining(['Anzahl', 'Name', 'Englischer Name', 'Sammlung', 'Passcode']))
    expect(rows[1]).toEqual(expect.arrayContaining([3, 'Dunkler Magier', 'Dark Magician', 'Box 1', '46986414']))
    expect(rows[2]).toEqual(expect.arrayContaining([1, 'Topf der Gier', '(keine Sammlung)']))
    expect(toasts()).toEqual([expect.stringMatching(/^success: inventar-alle-karten-.*\.xlsx heruntergeladen$/)])
  })

  it('downloads a Word document that says the list was filtered', async () => {
    const component = await mountMenu()
    await choose(component, 'Word-Dokument (.docx)')

    expect(downloads[0]!.name).toMatch(/\.docx$/)
    expect(downloads[0]!.blob.type).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    const parts = unzipSync(new Uint8Array(await downloads[0]!.blob.arrayBuffer()))
    const document = strFromU8(parts['word/document.xml']!)
    expect(document).toContain('Inventar – Alle Karten')
    expect(document).toContain('4 Karten · 2 verschiedene Karten · nur die Treffer der Suche · Stand ')
    expect(document).toContain('Box 1 · 3 Karten')
    expect(document).toContain('(keine Sammlung) · 1 Karte')
  })

  it('does not say "filtered" for the whole list', async () => {
    const component = await mountMenu({ filtered: false })
    await choose(component, 'Textliste (.txt)')

    const text = await downloads[0]!.blob.text()
    expect(text).toContain('# 4 Karten · 2 verschiedene Karten · Stand ')
    expect(text).not.toContain('Treffer')
    expect(text).toContain('3x Dunkler Magier')
    expect(text).toContain('1x Topf der Gier')
  })

  it('says so when nothing matches, and downloads nothing', async () => {
    answer = { items: [], truncated: false }
    const component = await mountMenu()
    await choose(component, 'Excel-Tabelle (.xlsx)')

    expect(downloads).toEqual([])
    expect(toasts()).toEqual(['warning: Es gibt keine Karten zum Exportieren.'])
  })

  it('says so when the server cut the list off', async () => {
    answer = { items: [row()], truncated: true }
    const component = await mountMenu()
    await choose(component, 'Textliste (.txt)')

    expect(downloads).toHaveLength(1)
    expect(toasts()).toContain('warning: Der Export enthält nur die ersten 1 Zeilen.')
  })

  it('shows an error and downloads nothing when the server fails, and works again afterwards', async () => {
    answer = 'error'
    const component = await mountMenu()
    await choose(component, 'Excel-Tabelle (.xlsx)')

    expect(downloads).toEqual([])
    expect(toasts()).toEqual(['error: Der Export hat nicht geklappt.'])

    answer = { items: [row()], truncated: false }
    await choose(component, 'Excel-Tabelle (.xlsx)')
    expect(downloads).toHaveLength(1)
  })

  it('is disabled when the list is empty', async () => {
    const component = await mountMenu({ disabled: true })

    expect(component.find('[data-testid="inventory-export"]').attributes('disabled')).toBeDefined()
    expect(component.find('[data-testid="inventory-export"]').attributes('title')).toBe('Es gibt keine Karten zum Exportieren.')
  })
})
