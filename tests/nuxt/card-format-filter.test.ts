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
  useState('card-locale-choice').value = null
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
  // "Zeta Theme" is made up: no German name, so it stays English; the real ones have the wiki's (ADR 0049).
  const archetypes = ['Zeta Theme', 'Blue-Eyes', 'Atlantis, City of the Sea Dragon']

  interface ArchetypeItem { label: string, value: string, names: string[], description?: string }

  function menuOf(component: { findComponent: (selector: unknown) => unknown }) {
    return component.findComponent(USelectMenu) as unknown as { props: (key: string) => unknown, emitted: (name: string) => unknown[][] | undefined }
  }
  const itemsOf = (component: { findComponent: (selector: unknown) => unknown }) => menuOf(component).props('items') as ArchetypeItem[]

  it('offers the archetypes sorted by what is shown, with the Deckthema label', async () => {
    const component = await mountSuspended(CardArchetypeFilter, { props: { archetypes, modelValue: [] } })

    expect(itemsOf(component).map(item => item.value)).toEqual(['Atlantis, City of the Sea Dragon', 'Blue-Eyes', 'Zeta Theme'])
    expect(itemsOf(component).map(item => item.label)).toEqual(['Atlantis, Stadt des Seedrachen', 'Blauäugig', 'Zeta Theme'])
    expect(component.find('[aria-label="Deckthema"]').exists()).toBe(true)
    expect(component.find('[aria-label="Deckthema"]').text()).toContain('Deckthema')
  })

  // Tester feedback, round 15: "Gib mir die Deckthemen auch auf Deutsch".
  it('shows the German name with the English one under it, and the English name is the value', async () => {
    const component = await mountSuspended(CardArchetypeFilter, { props: { archetypes, modelValue: [] } })

    const blueEyes = itemsOf(component).find(item => item.value === 'Blue-Eyes')
    expect(blueEyes).toEqual({ label: 'Blauäugig', value: 'Blue-Eyes', names: ['Blue-Eyes'], description: 'Blue-Eyes' })
    // No German name known: the English one, with nothing under it.
    expect(itemsOf(component).find(item => item.value === 'Zeta Theme')).toEqual({ label: 'Zeta Theme', value: 'Zeta Theme', names: ['Zeta Theme'] })
    // The search finds both names.
    expect(menuOf(component).props('filterFields')).toEqual(['label', 'value', 'description'])
  })

  it('shows the English names when the cards are English', async () => {
    useState('card-locale-choice').value = 'en'
    const component = await mountSuspended(CardArchetypeFilter, { props: { archetypes, modelValue: [] } })

    expect(itemsOf(component).find(item => item.value === 'Blue-Eyes')).toEqual({ label: 'Blue-Eyes', value: 'Blue-Eyes', names: ['Blue-Eyes'] })
  })

  // Tester feedback, round 15: "Magna Warrior" showed 2 cards. In German both archetypes are "Magnetkrieger".
  describe('two English archetypes with one German name', () => {
    const family = ['Magna Warrior', 'Magnet Warrior', 'Zeta Theme']
    const GROUP = ['Magna Warrior', 'Magnet Warrior'].join('\u001F')
    const menuModel = (component: { findComponent: (selector: unknown) => unknown }) => menuOf(component).props('modelValue') as string[]

    it('are one entry in German, with both English names under it', async () => {
      const component = await mountSuspended(CardArchetypeFilter, { props: { archetypes: family, modelValue: [] } })

      expect(itemsOf(component).map(item => item.label)).toEqual(['Magnetkrieger', 'Zeta Theme'])
      expect(itemsOf(component)[0]).toEqual({
        label: 'Magnetkrieger',
        value: GROUP,
        names: ['Magna Warrior', 'Magnet Warrior'],
        description: 'Magna Warrior · Magnet Warrior',
      })
    })

    it('stay two entries when the cards are English', async () => {
      useState('card-locale-choice').value = 'en'
      const component = await mountSuspended(CardArchetypeFilter, { props: { archetypes: family, modelValue: [] } })

      expect(itemsOf(component).map(item => item.label)).toEqual(['Magna Warrior', 'Magnet Warrior', 'Zeta Theme'])
      expect(itemsOf(component).every(item => item.names.length === 1)).toBe(true)
    })

    it('filter by both English names when the entry is picked, and by nothing when it is taken out again', async () => {
      const component = await mountSuspended(CardArchetypeFilter, { props: { archetypes: family, modelValue: ['Zeta Theme'] } })

      await (menuOf(component) as unknown as { vm: { $emit: (name: string, value: unknown) => void } }).vm.$emit('update:modelValue', ['Zeta Theme', GROUP])
      expect(component.emitted('update:modelValue')?.at(-1)).toEqual([['Magna Warrior', 'Magnet Warrior', 'Zeta Theme']])
    })

    it('shows the entry as picked when only one of its two names is in the filter, so no filter is hidden', async () => {
      const one = await mountSuspended(CardArchetypeFilter, { props: { archetypes: family, modelValue: ['Magna Warrior'] } })
      const none = await mountSuspended(CardArchetypeFilter, { props: { archetypes: family, modelValue: [] } })

      expect(menuModel(one)).toEqual([GROUP])
      expect(menuModel(none)).toEqual([])
      expect(one.find('[aria-label="Deckthema"]').text()).toContain('Magnetkrieger')
    })

    it('clears both names with the cross', async () => {
      const picked = await mountSuspended(CardArchetypeFilter, { props: { archetypes: family, modelValue: ['Magna Warrior', 'Magnet Warrior'] } })

      await picked.find('[data-slot="trailingClear"]').trigger('click')

      expect(picked.emitted('update:modelValue')?.at(-1)).toEqual([[]])
    })
  })

  it('shows what is picked', async () => {
    const component = await mountSuspended(CardArchetypeFilter, { props: { archetypes, modelValue: ['Blue-Eyes', 'Zeta Theme'] } })
    expect(component.find('[aria-label="Deckthema"]').text()).toContain('Blauäugig, Zeta Theme')
  })

  it('keeps a picked theme that is not in the list (an old link), so no filter is hidden', async () => {
    const component = await mountSuspended(CardArchetypeFilter, { props: { archetypes, modelValue: ['Old Theme'] } })
    expect(itemsOf(component).map(item => item.value)).toContain('Old Theme')
  })

  // Tester feedback, round 15: "bei jedem Deckthema-Filter die Möglichkeit, nur den Deckthema-Filter zurückzusetzen".
  it('has a cross that clears just this filter, only while something is picked', async () => {
    const empty = await mountSuspended(CardArchetypeFilter, { props: { archetypes, modelValue: [] } })
    expect(menuOf(empty).props('clear')).toBe(true)
    // The cross is a span inside the menu's button (a button in a button is not valid HTML).
    expect(empty.find('[data-slot="trailingClear"]').exists()).toBe(false)

    const picked = await mountSuspended(CardArchetypeFilter, { props: { archetypes, modelValue: ['Blue-Eyes'] } })
    const cross = picked.find('[data-slot="trailingClear"]')
    expect(cross.exists()).toBe(true)
    await cross.trigger('click')
    // Nothing is left, not `undefined`.
    expect(picked.emitted('update:modelValue')?.at(-1)).toEqual([[]])
  })

  it('is called "Archetype" in English', async () => {
    await setTestLocale('en')
    const component = await mountSuspended(CardArchetypeFilter, { props: { archetypes, modelValue: [] } })
    expect(component.find('[aria-label="Archetype"]').exists()).toBe(true)
  })
})
