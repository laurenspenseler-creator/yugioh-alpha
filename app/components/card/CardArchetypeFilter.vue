<script setup lang="ts">
/**
 * The "Deckthema" filter of the catalog and the inventory (tester feedback, round 14): the archetype of a card ("Blue-Eyes",
 * "Elemental HERO", "Six Samurai"), picked from a searchable list; several can be picked and a card needs one of them. The
 * names are the catalog's own (English); the catalog has no German names for archetypes.
 *
 * A theme that is picked but not in the list (the inventory's list follows what the player owns, an old link) stays in it,
 * so no filter is ever active without being visible.
 */
const props = withDefaults(defineProps<{
  /** Every archetype to offer. */
  archetypes: string[]
  menuClass?: string
}>(), { menuClass: 'w-full min-w-0' })

const selected = defineModel<string[]>({ required: true })

const { t } = useI18n()

const items = computed(() => [...new Set([...props.archetypes, ...selected.value])].sort((a, b) => a.localeCompare(b)))
</script>

<template>
  <USelectMenu
    v-model="selected"
    multiple
    :items="items"
    :placeholder="t('card.field.archetype')"
    :aria-label="t('card.field.archetype')"
    :search-input="{ placeholder: t('card.archetypeSearch') }"
    :class="menuClass"
    data-testid="card-archetype-filter"
  />
</template>
