import { afterEach, describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import type { VueWrapper } from '@vue/test-utils'
import { USelectMenu } from '#components'
import CardFacetFilters from '~/components/card/CardFacetFilters.vue'
import type { CardKind } from '~~/shared/card-kind'
import { setTestLocale } from './fixtures/locale'

// The facet menus shared by the catalog and the inventory (#63).

const facets = { types: ['Normal Monster'], attributes: ['LIGHT'], races: ['Dragon'], levels: [8] }

function mountFilters() {
  return mountSuspended(CardFacetFilters, {
    props: {
      facets,
      type: ['Normal Monster'],
      attribute: ['LIGHT'],
      race: [],
      level: [8],
    },
  })
}

afterEach(async () => {
  useState('card-locale-choice').value = null
  await setTestLocale('de')
})

describe('CardFacetFilters', () => {
  it('renders the four menus with German labels and German card values', async () => {
    const component = await mountFilters()

    for (const label of ['Typ', 'Attribut', 'Monsterart', 'Stufe/Rang']) {
      expect(component.find(`[aria-label="${label}"]`).exists()).toBe(true)
    }
    expect(component.find('[aria-label="Typ"]').text()).toContain('Normales Monster')
    expect(component.find('[aria-label="Attribut"]').text()).toContain('LICHT')
    // Konami's filter label: the level menu also matches Xyz ranks (#101).
    expect(component.find('[aria-label="Stufe/Rang"]').text()).toContain('Stufe/Rang 8')
    // Nothing picked: the menu shows its placeholder.
    expect(component.find('[aria-label="Monsterart"]').text()).toContain('Monsterart')
  })

  it('renders in English', async () => {
    await setTestLocale('en')
    const component = await mountFilters()

    for (const label of ['Type', 'Attribute', 'Monster type', 'Level/Rank']) {
      expect(component.find(`[aria-label="${label}"]`).exists()).toBe(true)
    }
    expect(component.find('[aria-label="Type"]').text()).toContain('Normal Monster')
    expect(component.find('[aria-label="Attribute"]').text()).toContain('LIGHT')
  })

  it('keeps German labels but shows English values when the cards are English (ADR 0015)', async () => {
    useState('card-locale-choice').value = 'en'
    const component = await mountFilters()

    expect(component.find('[aria-label="Typ"]').text()).toContain('Normal Monster')
    expect(component.find('[aria-label="Attribut"]').text()).toContain('LIGHT')
    expect(component.find('[aria-label="Attribut"]').text()).not.toContain('LICHT')
  })

  it('shows the "Kartenart" menu only when a kind model is given, before the exact type', async () => {
    const without = await mountFilters()
    expect(without.find('[aria-label="Kartenart"]').exists()).toBe(false)

    const component = await mountSuspended(CardFacetFilters, {
      props: { facets, kind: ['effect', 'pendulum'], type: [], attribute: [], race: [], level: [] },
    })
    const menu = component.find('[aria-label="Kartenart"]')
    expect(menu.exists()).toBe(true)
    expect(menu.text()).toContain('Effekt')
    expect(menu.text()).toContain('Pendel')
    // "Kartenart" comes first, "Typ" (the exact type line) stays as the finer menu.
    const labels = component.findAll('button[aria-label]').map(button => button.attributes('aria-label'))
    expect(labels.indexOf('Kartenart')).toBeLessThan(labels.indexOf('Typ'))
  })

  it('labels the kinds in English', async () => {
    await setTestLocale('en')
    const component = await mountSuspended(CardFacetFilters, {
      props: { facets, kind: ['token', 'spell'], type: [], attribute: [], race: [], level: [] },
    })
    expect(component.find('[aria-label="Card kind"]').text()).toContain('Token')
    expect(component.find('[aria-label="Card kind"]').text()).toContain('Spell')
  })
})

// Tester feedback: the menus were all about monsters. With the kind picked they follow it.
describe('CardFacetFilters following the kind', () => {
  const allFacets = {
    types: ['Effect Monster', 'Spell Card', 'Trap Card'],
    attributes: ['LIGHT'],
    races: ['Dragon', 'Warrior', 'Normal', 'Quick-Play', 'Continuous', 'Equip', 'Field', 'Ritual', 'Counter'],
    levels: [4],
  }

  function mountKinds(kind: CardKind[], patch: Record<string, unknown> = {}) {
    return mountSuspended(CardFacetFilters, {
      props: { facets: allFacets, kind, type: [], attribute: [], race: [], level: [], ...patch },
    })
  }

  const labels = (component: Awaited<ReturnType<typeof mountKinds>>) => component.findAll('button[aria-label]').map(button => button.attributes('aria-label'))
  const valuesOf = (component: Awaited<ReturnType<typeof mountKinds>>, label: string) => {
    // Every menu has its label as the placeholder, too.
    const menus = component.findAllComponents(USelectMenu) as unknown as VueWrapper[]
    const props = menus.map(menu => menu.props() as { placeholder?: string, items: Array<{ value: string }> })
    return props.find(candidate => candidate.placeholder === label)!.items.map(item => item.value).sort()
  }

  it('lists only the races of monsters under "Monsterart" while no Spell or Trap is picked', async () => {
    const none = await mountKinds([])
    const monsters = await mountKinds(['effect', 'link'])

    expect(valuesOf(none, 'Monsterart')).toEqual(['Dragon', 'Warrior'])
    expect(valuesOf(monsters, 'Monsterart')).toEqual(['Dragon', 'Warrior'])
    expect(labels(monsters)).toEqual(['Kartenart', 'Typ', 'Attribut', 'Monsterart', 'Stufe/Rang'])
  })

  it('offers Spells their own kinds and no monster menus: Zauberart instead of Typ, Attribut, Monsterart and Stufe', async () => {
    const component = await mountKinds(['spell'])

    expect(labels(component)).toEqual(['Kartenart', 'Zauberart'])
    expect(valuesOf(component, 'Zauberart')).toEqual(['Continuous', 'Equip', 'Field', 'Normal', 'Quick-Play', 'Ritual'])
  })

  // Tester feedback, round 9: "Spielfeld" and "Ritual" were missing from the inventory's Zauberart menu because the
  // facets only hold what the player owns. The subtypes are the game's own list, whatever the facets say.
  it('offers every subtype of a Spell or Trap, also the ones that the facets (the cards one owns) do not have', async () => {
    const owned = { types: ['Spell Card'], attributes: [], races: ['Dragon', 'Normal', 'Quick-Play', 'Continuous', 'Equip'], levels: [] }
    const spells = await mountKinds(['spell'], { facets: owned })
    const traps = await mountKinds(['trap'], { facets: owned })

    expect(valuesOf(spells, 'Zauberart')).toEqual(['Continuous', 'Equip', 'Field', 'Normal', 'Quick-Play', 'Ritual'])
    expect(valuesOf(traps, 'Fallenart')).toEqual(['Continuous', 'Counter', 'Normal'])
  })

  it('shows the symbol of the card frame next to each subtype, and none for Normal', async () => {
    const component = await mountKinds(['spell', 'trap'])
    const menus = component.findAllComponents(USelectMenu) as unknown as VueWrapper[]
    const items = menus
      .map(menu => menu.props() as { placeholder?: string, items: Array<{ value: string, label: string, icon?: string }> })
      .find(candidate => candidate.placeholder === 'Zauber-/Fallenart')!.items
    const iconOf = (value: string) => items.find(item => item.value === value)!.icon

    expect(iconOf('Continuous')).toBe('i-lucide-infinity')
    expect(iconOf('Equip')).toBe('i-lucide-plus')
    expect(iconOf('Field')).toBe('i-lucide-compass')
    expect(iconOf('Quick-Play')).toBe('i-lucide-zap')
    expect(iconOf('Ritual')).toBe('i-lucide-flame')
    expect(iconOf('Counter')).toBe('i-lucide-corner-down-left')
    expect(iconOf('Normal')).toBeUndefined()
  })

  // Tester feedback, round 10: "Setz Normal nach oben": the plain Spell or Trap leads the list, the others stay in the
  // order of their names.
  it('lists "Normal" first, then the other subtypes by name', async () => {
    const orderOf = (component: Awaited<ReturnType<typeof mountKinds>>, label: string) => {
      const menus = component.findAllComponents(USelectMenu) as unknown as VueWrapper[]
      const props = menus.map(menu => menu.props() as { placeholder?: string, items: Array<{ value: string }> })
      return props.find(candidate => candidate.placeholder === label)!.items.map(item => item.value)
    }

    const spells = await mountKinds(['spell'])
    const traps = await mountKinds(['trap'])
    const both = await mountKinds(['spell', 'trap'])

    // Ausrüstung, Permanent, Ritual, Schnell, Spielfeld.
    expect(orderOf(spells, 'Zauberart')).toEqual(['Normal', 'Equip', 'Continuous', 'Ritual', 'Quick-Play', 'Field'])
    // Konter, Permanent.
    expect(orderOf(traps, 'Fallenart')).toEqual(['Normal', 'Counter', 'Continuous'])
    expect(orderOf(both, 'Zauber-/Fallenart')).toEqual(['Normal', 'Equip', 'Counter', 'Continuous', 'Ritual', 'Quick-Play', 'Field'])
  })

  it('offers Traps theirs, and both together the lot', async () => {
    const traps = await mountKinds(['trap'])
    const both = await mountKinds(['spell', 'trap'])

    expect(labels(traps)).toEqual(['Kartenart', 'Fallenart'])
    expect(valuesOf(traps, 'Fallenart')).toEqual(['Continuous', 'Counter', 'Normal'])
    expect(labels(both)).toEqual(['Kartenart', 'Zauber-/Fallenart'])
    expect(valuesOf(both, 'Zauber-/Fallenart')).toEqual(['Continuous', 'Counter', 'Equip', 'Field', 'Normal', 'Quick-Play', 'Ritual'])
  })

  it('keeps every menu, with every race, when monsters and Spells are picked together', async () => {
    const component = await mountKinds(['effect', 'spell'])

    expect(labels(component)).toEqual(['Kartenart', 'Typ', 'Attribut', 'Art', 'Stufe/Rang'])
    expect(valuesOf(component, 'Art')).toHaveLength(allFacets.races.length)
  })

  it('names the menus in English', async () => {
    await setTestLocale('en')
    const spells = await mountKinds(['spell'])
    const traps = await mountKinds(['trap'])

    expect(labels(spells)).toEqual(['Card kind', 'Spell type'])
    expect(labels(traps)).toEqual(['Card kind', 'Trap type'])
  })

  it('keeps a value that is still picked visible, so no filter is active without showing', async () => {
    const component = await mountKinds(['spell'], { type: ['Effect Monster'], race: ['Dragon'] })

    expect(labels(component)).toEqual(['Kartenart', 'Typ', 'Zauberart'])
    expect(valuesOf(component, 'Zauberart')).toContain('Dragon')
  })

  it('takes the monster filters along when the kind changes to Spells, and a Spell\'s kind when it changes to monsters', async () => {
    const component = await mountKinds(['effect'], { type: ['Effect Monster'], attribute: ['LIGHT'], race: ['Dragon'], level: [4] })

    await component.setProps({ kind: ['spell'] })
    expect(component.emitted('update:type')!.at(-1)).toEqual([[]])
    expect(component.emitted('update:attribute')!.at(-1)).toEqual([[]])
    expect(component.emitted('update:level')!.at(-1)).toEqual([[]])
    // The race 'Dragon' does not belong to a Spell.
    expect(component.emitted('update:race')!.at(-1)).toEqual([[]])

    const back = await mountKinds(['spell'], { race: ['Quick-Play', 'Field'] })
    await back.setProps({ kind: ['effect'] })
    expect(back.emitted('update:race')!.at(-1)).toEqual([[]])
  })

  it('leaves the subtypes that fit when Spells and Traps are both picked and one of them goes', async () => {
    const component = await mountKinds(['spell', 'trap'], { race: ['Quick-Play', 'Counter'] })

    await component.setProps({ kind: ['trap'] })
    expect(component.emitted('update:race')!.at(-1)).toEqual([['Counter']])
  })

  it('stays as it was without a kind menu (the format editor)', async () => {
    const component = await mountSuspended(CardFacetFilters, {
      props: { facets: allFacets, type: [], attribute: [], race: [], level: [] },
    })

    expect(valuesOf(component as never, 'Monsterart')).toHaveLength(allFacets.races.length)
  })
})
