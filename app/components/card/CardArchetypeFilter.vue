<script setup lang="ts">
import { archetypeName } from '~~/shared/archetype-names-de'

/**
 * The "Deckthema" filter of the catalog and the inventory (tester feedback, round 14): the archetype of a card ("Blue-Eyes",
 * "Elemental HERO", "Six Samurai"), picked from a searchable list; several can be picked and a card needs one of them.
 *
 * The catalog only has English names. In the German card language the ones with a known German name (`shared/archetype-names-de`)
 * show it ("Elementar-HELD") with the English name under it, and the search finds either; the value that goes to the filter
 * is always the English name. Round 15: "Gib mir die Deckthemen auch auf Deutsch".
 *
 * A theme that is picked but not in the list (the inventory's list follows what the player owns, an old link) stays in it,
 * so no filter is ever active without being visible. With something picked, a small cross in the menu clears just this filter.
 */
const props = withDefaults(defineProps<{
  /** Every archetype to offer, by its English name. */
  archetypes: string[]
  menuClass?: string
}>(), { menuClass: 'w-full min-w-0' })

// The clear button of the menu leaves nothing, not an empty list.
const selected = defineModel<string[]>({ required: true, set: value => value ?? [] })

const { t } = useI18n()
const { cardLocale } = useCardText()

const items = computed(() => [...new Set([...props.archetypes, ...selected.value])]
  .map((value) => {
    const label = archetypeName(value, cardLocale.value)
    return label === value ? { label, value } : { label, value, description: value }
  })
  .sort((a, b) => a.label.localeCompare(b.label, cardLocale.value)))
</script>

<template>
  <USelectMenu
    v-model="selected"
    multiple
    clear
    value-key="value"
    :items="items"
    :filter-fields="['label', 'value']"
    :placeholder="t('card.field.archetype')"
    :aria-label="t('card.field.archetype')"
    :search-input="{ placeholder: t('card.archetypeSearch') }"
    :class="menuClass"
    data-testid="card-archetype-filter"
  />
</template>
