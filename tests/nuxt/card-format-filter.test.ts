// The "Zulässigkeit" (format) and "Deckthema" menus of the catalog and the inventory (tester feedback, round 14).
import { afterEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount } from '@vue/test-utils'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { USelect, USelectMenu } from '#components'
import CardArchetypeFilter from '~/components/card/CardArchetypeFilter.vue'
import CardFormatFilter from '~/components/card/CardFormatFilter.vue'
import { setTestLocale } from './fixtures/locale'
import { optionLabels, selectWithOption } from './fixtures/select-wrapper'

const state = vi.hoisted(() => ({
  items: [] as Array<{ id: string, name: string, isBuiltin: boolean }>,
  status: 'success' as string,
}))

mockNuxtImport('useFetch', () => {
  return () => ({ data: ref({ items: state.items }), status: ref(state.status) })
})

enableAutoUnmount(afterEach)

afterEach(async () => {
  state.items = []
  state.status = 'success'
  await setTestLocale('de')
})

const FORMATS = [
  { id: 'goat', name: 'Goat', isBuiltin: true },
  { id: 'tcg-advanced', name: 'TCG Advanced', isBuiltin: true },
  { id: 'own-1', name: 'Mein Format', isBuiltin: false },
]

describe('CardFormatFilter', () => {
  it('offers "Alle Formate", the built-in formats by name, then the player\'s own', async () => {
    state.items = FORMATS
    const component = await mountSuspended(CardFormatFilter, { props: { formatId: '', legality: 'legal' } })
    const select = selectWithOption(component.findAllComponents(USelect), 'goat')!

    // Built-ins first, sorted by their name in the interface language.
    expect(optionLabels(select)[0]).toBe('Alle Formate')
    expect(optionLabels(select).at(-1)).toBe('Mein Format')
    expect(optionLabels(select)).toHaveLength(4)
    expect(select.props('modelValue')).toBe('none')
  })

  it('shows the "Zulässigkeit" menu only while a format is picked', async () => {
    state.items = FORMATS
    const without = await mountSuspended(CardFormatFilter, { props: { formatId: '', legality: 'legal' } })
    expect(without.find('[aria-label="Zulässigkeit"]').exists()).toBe(false)

    const component = await mountSuspended(CardFormatFilter, { props: { formatId: 'goat', legality: 'legal' } })
    // A built-in format is shown by its translated name.
    expect(component.find('[aria-label="Format"]').text()).toContain('GOAT')
    const legality = selectWithOption(component.findAllComponents(USelect), 'limited')!
    expect(optionLabels(legality)).toEqual([
      'Zulässig',
      'Nicht zulässig',
      'Unbeschränkt (3 Kopien)',
      'Semi-limitiert (2 Kopien)',
      'Limitiert (1 Kopie)',
    ])
    expect(legality.props('modelValue')).toBe('legal')
  })

  it('turns "Alle Formate" into no format, and a format into its id', async () => {
    state.items = FORMATS
    const component = await mountSuspended(CardFormatFilter, { props: { formatId: 'goat', legality: 'legal' } })
    const select = selectWithOption(component.findAllComponents(USelect), 'goat')!

    await select.setValue('tcg-advanced')
    expect(component.emitted('update:formatId')?.at(-1)).toEqual(['tcg-advanced'])
    await select.setValue('none')
    expect(component.emitted('update:formatId')?.at(-1)).toEqual([''])
  })

  it('passes the legality the player picks', async () => {
    state.items = FORMATS
    const component = await mountSuspended(CardFormatFilter, { props: { formatId: 'goat', legality: 'legal' } })
    await selectWithOption(component.findAllComponents(USelect), 'limited')!.setValue('semi_limited')
    expect(component.emitted('update:legality')?.at(-1)).toEqual(['semi_limited'])
  })

  it('drops a format that is not in the list once the list is there, and keeps it while it loads', async () => {
    state.items = FORMATS
    state.status = 'pending'
    const loading = await mountSuspended(CardFormatFilter, { props: { formatId: 'gone', legality: 'legal' } })
    expect(loading.emitted('update:formatId')).toBeUndefined()

    state.status = 'success'
    const component = await mountSuspended(CardFormatFilter, { props: { formatId: 'gone', legality: 'legal' } })
    expect(component.emitted('update:formatId')?.at(-1)).toEqual([''])
  })

  it('renders in English', async () => {
    await setTestLocale('en')
    state.items = FORMATS
    const component = await mountSuspended(CardFormatFilter, { props: { formatId: 'goat', legality: 'legal' } })
    const legality = selectWithOption(component.findAllComponents(USelect), 'limited')!
    expect(optionLabels(legality)).toEqual(['Allowed', 'Not allowed', 'Unlimited (3 copies)', 'Semi-limited (2 copies)', 'Limited (1 copy)'])
    expect(component.find('[aria-label="Legality"]').exists()).toBe(true)
  })
})

describe('CardArchetypeFilter', () => {
  const archetypes = ['Stardust', 'Blue-Eyes', 'Atlantis, City of the Sea Dragon']

  function itemsOf(component: { findComponent: (selector: unknown) => unknown }) {
    const menu = component.findComponent(USelectMenu) as unknown as { props: (key: string) => unknown }
    return menu.props('items') as string[]
  }

  it('offers the archetypes sorted, with the Deckthema label', async () => {
    const component = await mountSuspended(CardArchetypeFilter, { props: { archetypes, modelValue: [] } })

    expect(itemsOf(component)).toEqual(['Atlantis, City of the Sea Dragon', 'Blue-Eyes', 'Stardust'])
    expect(component.find('[aria-label="Deckthema"]').exists()).toBe(true)
    expect(component.find('[aria-label="Deckthema"]').text()).toContain('Deckthema')
  })

  it('shows what is picked', async () => {
    const component = await mountSuspended(CardArchetypeFilter, { props: { archetypes, modelValue: ['Blue-Eyes', 'Stardust'] } })
    expect(component.find('[aria-label="Deckthema"]').text()).toContain('Blue-Eyes, Stardust')
  })

  it('keeps a picked theme that is not in the list (an old link), so no filter is hidden', async () => {
    const component = await mountSuspended(CardArchetypeFilter, { props: { archetypes, modelValue: ['Old Theme'] } })
    expect(itemsOf(component)).toContain('Old Theme')
  })

  it('is called "Archetype" in English', async () => {
    await setTestLocale('en')
    const component = await mountSuspended(CardArchetypeFilter, { props: { archetypes, modelValue: [] } })
    expect(component.find('[aria-label="Archetype"]').exists()).toBe(true)
  })
})
