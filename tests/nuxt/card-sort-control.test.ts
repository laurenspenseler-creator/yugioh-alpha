// The "Sortierung" menu with a small button for the direction, the same in every card list (tester feedback, round 16).
import { afterEach, describe, expect, it } from 'vitest'
import { enableAutoUnmount } from '@vue/test-utils'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { USelect } from '#components'
import CardSortControl from '~/components/card/CardSortControl.vue'
import { setTestLocale } from './fixtures/locale'
import { optionLabels } from './fixtures/select-wrapper'
import type { SelectWrapper } from './fixtures/select-wrapper'

enableAutoUnmount(afterEach)

afterEach(async () => {
  await setTestLocale('de')
})

const selectOf = (component: { findComponent: (selector: unknown) => unknown }) => component.findComponent(USelect) as unknown as SelectWrapper

describe('the sort control', () => {
  it('offers the seven fields: release date, ATK, DEF, level, name, card type, pendulum scale', async () => {
    const component = await mountSuspended(CardSortControl, { props: { modelValue: 'name' } })

    expect(optionLabels(selectOf(component))).toEqual(['Erscheinungsdatum', 'Angriff', 'Defensive', 'Stufe', 'Name', 'Kartentyp', 'Pendelbereich'])
    expect(component.text()).toContain('Sortierung')
  })

  it('is called "Sort by" in English, with English fields', async () => {
    await setTestLocale('en')
    const component = await mountSuspended(CardSortControl, { props: { modelValue: 'name' } })

    expect(optionLabels(selectOf(component))).toEqual(['Release date', 'ATK', 'DEF', 'Level', 'Name', 'Card type', 'Pendulum scale'])
    expect(component.text()).toContain('Sort by')
  })

  it('shows the field of the value and the direction of its "-"', async () => {
    const ascending = await mountSuspended(CardSortControl, { props: { modelValue: 'atk' } })
    const descending = await mountSuspended(CardSortControl, { props: { modelValue: '-atk' } })

    expect(selectOf(ascending).props('modelValue')).toBe('atk')
    expect(selectOf(descending).props('modelValue')).toBe('atk')
    expect(ascending.find('[data-testid="card-sort-direction"]').attributes('aria-label')).toBe('Aufsteigend')
    expect(descending.find('[data-testid="card-sort-direction"]').attributes('aria-label')).toBe('Absteigend')
  })

  it('flips the direction with the small button and keeps the field', async () => {
    const component = await mountSuspended(CardSortControl, { props: { modelValue: 'level' } })

    await component.find('[data-testid="card-sort-direction"]').trigger('click')
    expect(component.emitted('update:modelValue')).toEqual([['-level']])

    const down = await mountSuspended(CardSortControl, { props: { modelValue: '-level' } })
    await down.find('[data-testid="card-sort-direction"]').trigger('click')
    expect(down.emitted('update:modelValue')).toEqual([['level']])
  })

  it('keeps the direction when another field is chosen', async () => {
    const component = await mountSuspended(CardSortControl, { props: { modelValue: '-name' } })

    await selectOf(component).setValue('def')

    expect(component.emitted('update:modelValue')).toEqual([['-def']])
  })

  it('has the fields of the list on top: the inventory\'s "Zuletzt geändert" and "Anzahl", with a direction too', async () => {
    const list = await mountSuspended(CardSortControl, { props: { modelValue: '-updated', extras: ['updated'] } })
    const gallery = await mountSuspended(CardSortControl, { props: { modelValue: 'quantity', extras: ['quantity'] } })

    expect(optionLabels(selectOf(list))[0]).toBe('Zuletzt geändert')
    expect(selectOf(list).props('modelValue')).toBe('updated')
    expect(list.find('[data-testid="card-sort-direction"]').attributes('aria-label')).toBe('Absteigend')
    expect(optionLabels(selectOf(gallery))[0]).toBe('Anzahl')
    await selectOf(gallery).setValue('atk')
    expect(gallery.emitted('update:modelValue')).toEqual([['atk']])
  })

  it('has choices without a direction (the deck editor\'s "Standard"), and then no button', async () => {
    const component = await mountSuspended(CardSortControl, { props: { modelValue: 'default', plain: ['default'] } })

    expect(optionLabels(selectOf(component))[0]).toBe('Standard')
    expect(selectOf(component).props('modelValue')).toBe('default')
    expect(component.find('[data-testid="card-sort-direction"]').exists()).toBe(false)

    // From the usual order to a field: the direction starts ascending.
    await selectOf(component).setValue('release')
    expect(component.emitted('update:modelValue')).toEqual([['release']])
    // And back: the plain choice goes out as it is.
    const field = await mountSuspended(CardSortControl, { props: { modelValue: '-release', plain: ['default'] } })
    await selectOf(field).setValue('default')
    expect(field.emitted('update:modelValue')).toEqual([['default']])
  })

  it('reads the older "newest" as the release date, newest first', async () => {
    const component = await mountSuspended(CardSortControl, { props: { modelValue: 'newest' } })

    expect(selectOf(component).props('modelValue')).toBe('release')
    expect(component.find('[data-testid="card-sort-direction"]').attributes('aria-label')).toBe('Absteigend')
  })
})
