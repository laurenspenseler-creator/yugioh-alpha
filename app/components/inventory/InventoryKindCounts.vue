<script setup lang="ts">
/**
 * How many copies of each card kind the inventory holds (Normal, Effekt,
 * Ritual, Zauber, Falle, Fusion, Synchro, Xyz, Pendel, Link), as chips with the
 * frame's colour dot, in a row of their own under the filters (tester feedback).
 * Every kind has its chip, also with 0 copies, so the row never changes shape; the
 * chips share the whole row evenly and never wrap (on a phone the row scrolls
 * sideways). A chip is also a quick filter: it toggles that "Kartenart" in the
 * filters. "Sonstige" (tokens, skills) has no filter key, so it is a plain label.
 */
import type { CardKind } from '~~/shared/card-kind'
import { INVENTORY_KINDS } from '~~/shared/deck-breakdown'
import type { InventoryKind } from '~~/shared/deck-breakdown'

const props = defineProps<{
  /** The kinds with copies; the others are added here with 0. */
  kinds: Array<{ kind: InventoryKind, count: number }>
  /** The kinds currently selected in the "Kartenart" filter. */
  active: CardKind[]
}>()

const emit = defineEmits<{
  toggle: [kind: CardKind]
}>()

const { t, n } = useI18n()

const chips = computed(() => {
  const counts = new Map(props.kinds.map(entry => [entry.kind, entry.count]))
  const all = INVENTORY_KINDS.map(kind => ({ kind: kind as InventoryKind, count: counts.get(kind) ?? 0 }))
  const other = counts.get('other')
  return other ? [...all, { kind: 'other' as InventoryKind, count: other }] : all
})

function isActive(kind: InventoryKind): boolean {
  return kind !== 'other' && props.active.includes(kind)
}
</script>

<template>
  <ul
    v-if="kinds.length > 0"
    class="flex min-w-0 flex-nowrap items-stretch gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    :aria-label="t('inventory.kinds.label')"
    data-testid="inventory-kind-counts"
  >
    <!-- Every chip grows to the same share of the row; the minimum keeps all ten on one
         line from about 850px, below that the row scrolls instead of wrapping. -->
    <li
      v-for="entry in chips"
      :key="entry.kind"
      class="flex min-w-[4.75rem] flex-1 basis-[4.75rem]"
      :data-kind="entry.kind"
      :data-frame="entry.kind === 'other' ? undefined : entry.kind"
    >
      <button
        v-if="entry.kind !== 'other'"
        type="button"
        class="inline-flex w-full cursor-pointer items-center justify-center gap-1 whitespace-nowrap rounded-full px-2 py-1.5 text-xs text-default ring-1 ring-inset transition-colors hover:bg-elevated disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent"
        :class="isActive(entry.kind) ? 'bg-primary/10 ring-primary' : 'bg-elevated/60 ring-default'"
        :aria-pressed="isActive(entry.kind)"
        :disabled="entry.count === 0 && !isActive(entry.kind)"
        :aria-label="t('inventory.kinds.filterBy', { kind: t(`decks.breakdown.short.${entry.kind}`), count: n(entry.count, 'integer') })"
        @click="emit('toggle', entry.kind)"
      >
        <span
          class="frame-dot"
          aria-hidden="true"
        />
        <span
          class="tabular-nums"
          aria-hidden="true"
        >{{ n(entry.count, 'integer') }} {{ t(`decks.breakdown.short.${entry.kind}`) }}</span>
      </button>
      <span
        v-else
        class="inline-flex w-full items-center justify-center gap-1 whitespace-nowrap rounded-full bg-elevated/60 px-2 py-1.5 text-xs text-default ring-1 ring-default ring-inset"
      >
        <span class="tabular-nums">{{ n(entry.count, 'integer') }} {{ t('decks.breakdown.short.other') }}</span>
      </span>
    </li>
  </ul>
</template>
