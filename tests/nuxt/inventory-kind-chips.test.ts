// The chips under the inventory's filters: all ten kinds in one row, also with 0 copies.
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import InventoryKindCounts from '~/components/inventory/InventoryKindCounts.vue'

describe('InventoryKindCounts', () => {
  it('shows every kind in the same order, Pendel between Xyz and Link, also the ones without copies', async () => {
    const component = await mountSuspended(InventoryKindCounts, {
      props: { kinds: [{ kind: 'normal', count: 12 }, { kind: 'effect', count: 70 }, { kind: 'link', count: 1 }], active: [] },
    })

    const chips = component.findAll('li')
    expect(chips.map(chip => chip.attributes('data-kind'))).toEqual(['normal', 'effect', 'ritual', 'spell', 'trap', 'fusion', 'synchro', 'xyz', 'pendulum', 'link'])
    expect(chips.find(chip => chip.attributes('data-kind') === 'pendulum')!.text()).toBe('0 Pendel')
    expect(chips.find(chip => chip.attributes('data-kind') === 'effect')!.text()).toBe('70 Effekt')
  })

  it('keeps the chips in one row: no wrapping, the row scrolls sideways when it is too narrow', async () => {
    const component = await mountSuspended(InventoryKindCounts, { props: { kinds: [{ kind: 'effect', count: 3 }], active: [] } })

    const row = component.find('[data-testid="inventory-kind-counts"]')
    expect(row.classes()).toContain('flex-nowrap')
    expect(row.classes()).not.toContain('flex-wrap')
    expect(row.classes()).toContain('overflow-x-auto')
  })

  it('lets a chip without copies be neither clicked nor selected, but one that is selected can be taken off', async () => {
    const component = await mountSuspended(InventoryKindCounts, {
      props: { kinds: [{ kind: 'effect', count: 3 }, { kind: 'xyz', count: 0 }], active: ['xyz'] },
    })

    const button = (kind: string) => component.find(`li[data-kind="${kind}"] button`)
    expect(button('pendulum').attributes('disabled')).toBeDefined()
    expect(button('effect').attributes('disabled')).toBeUndefined()
    expect(button('xyz').attributes('disabled')).toBeUndefined()
    expect(button('xyz').attributes('aria-pressed')).toBe('true')

    await button('effect').trigger('click')
    expect(component.emitted('toggle')).toEqual([['effect']])
  })

  it('adds "Sonstige" only when there are such copies, and shows nothing for an empty inventory', async () => {
    const withOther = await mountSuspended(InventoryKindCounts, { props: { kinds: [{ kind: 'other', count: 2 }], active: [] } })
    expect(withOther.findAll('li').map(chip => chip.attributes('data-kind')).at(-1)).toBe('other')

    const empty = await mountSuspended(InventoryKindCounts, { props: { kinds: [], active: [] } })
    expect(empty.find('[data-testid="inventory-kind-counts"]').exists()).toBe(false)
  })
})
