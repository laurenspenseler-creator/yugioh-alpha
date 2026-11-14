<script setup lang="ts">
import { FORMAT_LEGALITIES } from '~~/shared/format-legality'
import type { FormatLegality } from '~~/shared/format-legality'

/**
 * The "Zulässigkeit" filter of the catalog and the inventory (tester feedback, round 14): pick a rule format, then what to
 * show of it: the cards the format allows (the default), the ones it does not, or the ones at a number of copies (limited,
 * semi-limited, unlimited). Two menus, no wrapper: the parent's flex or grid places them, and `menuClass` sets their width.
 *
 * - `formatId` is `''` for no format (nothing is filtered); the "Zulässigkeit" menu only shows while a format is picked.
 * - A format that is picked but no longer in the list (deleted, or another player's: an old link) is dropped once the list
 *   is known, so no filter is ever active without being visible.
 */
withDefaults(defineProps<{
  menuClass?: string
}>(), { menuClass: 'w-full min-w-0' })

const formatId = defineModel<string>('formatId', { required: true })
const legality = defineModel<FormatLegality>('legality', { required: true })

const { t } = useI18n()
const { formatName, sortFormats } = useFormatLabel()

// reka-ui reserves the empty string for "clear selection", so "no format" uses a sentinel (as the format selects elsewhere).
const NO_FORMAT = 'none'

interface FormatListItem {
  id: string
  name: string
  isBuiltin: boolean
}

const { data, status } = await useFetch<{ items: FormatListItem[] }>('/api/formats', {
  headers: import.meta.server ? useRequestHeaders(['cookie']) : undefined,
  default: () => ({ items: [] }),
})

const formatItems = computed(() => [
  { label: t('card.legality.anyFormat'), value: NO_FORMAT },
  ...sortFormats(data.value?.items ?? []).map(format => ({ label: formatName(format), value: format.id })),
])
const legalityItems = computed(() => FORMAT_LEGALITIES.map(value => ({ label: t(`card.legality.${value}`), value })))

const selectedFormat = computed({
  get: () => formatId.value || NO_FORMAT,
  set: (value: string) => {
    formatId.value = value === NO_FORMAT ? '' : value
  },
})

// Right away too: the list is usually there already when the menu is made (the fetch above is awaited).
watch([() => status?.value, () => data.value?.items, formatId], () => {
  if (status?.value === 'success' && formatId.value && !(data.value?.items ?? []).some(format => format.id === formatId.value)) {
    formatId.value = ''
  }
}, { immediate: true })
</script>

<template>
  <USelect
    v-model="selectedFormat"
    :items="formatItems"
    :placeholder="t('card.field.format')"
    :aria-label="t('card.field.format')"
    :class="menuClass"
    data-testid="card-format-filter"
  />
  <USelect
    v-if="formatId"
    v-model="legality"
    :items="legalityItems"
    :aria-label="t('card.field.legality')"
    :class="menuClass"
    data-testid="card-legality-filter"
  />
</template>
