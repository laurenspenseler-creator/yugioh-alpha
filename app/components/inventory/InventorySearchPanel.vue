<script setup lang="ts">
import type { CardKind } from '~~/shared/card-kind'
import type { InventoryKind } from '~~/shared/deck-breakdown'
import { DEFAULT_FORMAT_LEGALITY } from '~~/shared/format-legality'
import type { FormatLegality } from '~~/shared/format-legality'
import type { CardFacetOptions } from '~/components/card/CardFacetFilters.vue'

export interface InventorySearchFilters {
  kind: CardKind[]
  type: string[]
  attribute: string[]
  race: string[]
  level: number[]
  /** "Deckthema" (tester feedback, round 14): the archetypes a card may have. */
  archetype: string[]
  /** "Zulässigkeit" (tester feedback, round 14): a rule format (`''` for none) and what to show of it. */
  formatId: string
  legality: FormatLegality
  /** The gallery's order: a field of shared/card-sort.ts or `quantity`, "-" in front for descending (`name`, `-atk`). */
  sort: string
}

// The sort is not here: it sits in the toolbar above the cards (tester feedback, round 16), next to how many cards the
// view lists, for the list and the gallery alike.
withDefaults(defineProps<{
  facets: CardFacetOptions
  /** Different cards per card kind, shown as chips in a row under the filters; they also toggle the "Kartenart" filter. */
  kindCounts?: Array<{ kind: InventoryKind, count: number }>
}>(), {
  kindCounts: () => [],
})

const { t } = useI18n()

const filters = defineModel<InventorySearchFilters>('filters', { required: true })

function toggleKind(kind: CardKind) {
  filters.value.kind = filters.value.kind.includes(kind)
    ? filters.value.kind.filter(selected => selected !== kind)
    : [...filters.value.kind, kind]
}

function resetFilters() {
  // Mutate the shared filters object in place (rather than reassigning
  // `filters.value`) so fields owned by the parent (q, inText, page) that
  // this panel doesn't render controls for are left untouched. The
  // collection is the page's scope (URL), not a filter — Reset keeps it.
  filters.value.kind = []
  filters.value.type = []
  filters.value.attribute = []
  filters.value.race = []
  filters.value.level = []
  filters.value.archetype = []
  filters.value.formatId = ''
  filters.value.legality = DEFAULT_FORMAT_LEGALITY
  filters.value.sort = 'name'
}
</script>

<template>
  <div class="space-y-3">
    <div class="flex flex-wrap items-center gap-2">
      <CardFacetFilters
        v-model:kind="filters.kind"
        v-model:type="filters.type"
        v-model:attribute="filters.attribute"
        v-model:race="filters.race"
        v-model:level="filters.level"
        :facets="facets"
        menu-class="w-36"
      />
      <CardArchetypeFilter
        v-model="filters.archetype"
        :archetypes="facets.archetypes ?? []"
        menu-class="w-44"
      />
      <CardFormatFilter
        v-model:format-id="filters.formatId"
        v-model:legality="filters.legality"
        menu-class="w-44"
      />
      <UButton
        icon="i-lucide-rotate-ccw"
        color="neutral"
        variant="ghost"
        :label="t('inventory.search.reset')"
        @click="resetFilters"
      />
    </div>

    <!-- Ten chips are more than fit beside the filters: a row of their own, filled edge to edge. -->
    <InventoryKindCounts
      :kinds="kindCounts"
      :active="filters.kind"
      @toggle="toggleKind"
    />
  </div>
</template>
