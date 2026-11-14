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
 * Two English archetypes can have one German name ("Magna Warrior" and "Magnet Warrior" are both "Magnetkrieger"): the menu then
 * has a single entry for them, and picking it filters by both English names.
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

// Several English names in one entry are told apart by a character no archetype name has.
const GROUP_SEPARATOR = '\u001F'

interface ArchetypeEntry {
  label: string
  /** The English name, or the English names of a group joined by `GROUP_SEPARATOR`. */
  value: string
  /** The English names the entry stands for. */
  names: string[]
  description?: string
}

const entries = computed<ArchetypeEntry[]>(() => {
  const byLabel = new Map<string, string[]>()
  for (const name of new Set([...props.archetypes, ...selected.value])) {
    const label = archetypeName(name, cardLocale.value)
    byLabel.set(label, [...(byLabel.get(label) ?? []), name])
  }
  return [...byLabel]
    .map(([label, names]): ArchetypeEntry => {
      const english = [...names].sort((a, b) => a.localeCompare(b)).join(' · ')
      return { label, value: names.join(GROUP_SEPARATOR), names, ...(label === english ? {} : { description: english }) }
    })
    .sort((a, b) => a.label.localeCompare(b.label, cardLocale.value))
})

// What the menu has picked: the entries of which at least one English name is in the filter (so a link with only one of
// two names still shows the entry), and picking an entry sets all its names.
const pickedEntries = computed({
  get: () => entries.value.filter(entry => entry.names.some(name => selected.value.includes(name))).map(entry => entry.value),
  set: (values: string[] | undefined) => {
    const picked = new Set(values ?? [])
    selected.value = entries.value.filter(entry => picked.has(entry.value)).flatMap(entry => entry.names)
  },
})
</script>

<template>
  <USelectMenu
    v-model="pickedEntries"
    multiple
    clear
    value-key="value"
    :items="entries"
    :filter-fields="['label', 'value', 'description']"
    :placeholder="t('card.field.archetype')"
    :aria-label="t('card.field.archetype')"
    :search-input="{ placeholder: t('card.archetypeSearch') }"
    :class="menuClass"
    data-testid="card-archetype-filter"
  />
</template>
