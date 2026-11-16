<script setup lang="ts">
import { CARD_SORT_FIELDS, flipDirection, parseSortValue, sortValueOf } from '~~/shared/card-sort'

/**
 * "Sortierung" of every card list (tester feedback, round 16: one way to sort everywhere, "daneben ein kleiner Schalter, von auf-
 * und absteigend"): a menu with the field (release date, ATK, DEF, level, name, card type, pendulum scale) and a small button
 * that flips the direction. The value is the one of the URL and the API (`shared/card-sort.ts`): the field, with "-" in front
 * for descending ("atk", "-atk").
 *
 * `extras` are fields a list has on top of the card's own (the inventory's "updated" and "quantity"), with a direction like
 * the others; `plain` are choices without a direction (the deck editor's "Standard").
 */
const props = withDefaults(defineProps<{
  modelValue: string
  extras?: readonly string[]
  plain?: readonly string[]
  /** Hides the visible "Sortierung" text (the menu keeps it as its label for screen readers). */
  compact?: boolean
}>(), { extras: () => [], plain: () => [], compact: false })

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const { t } = useI18n()

const fields = computed(() => [...CARD_SORT_FIELDS, ...props.extras])
const isPlain = computed(() => props.plain.includes(props.modelValue))
const current = computed(() => parseSortValue(props.modelValue, fields.value))
const field = computed(() => isPlain.value ? props.modelValue : current.value?.field ?? CARD_SORT_FIELDS[0])
const direction = computed(() => current.value?.direction ?? 'asc')

const items = computed(() => [...props.plain, ...props.extras, ...CARD_SORT_FIELDS]
  .map(value => ({ label: t(`card.sort.field.${value}`), value })))

// Another field keeps the direction that is chosen.
function pick(value: string | undefined) {
  if (!value) {
    return
  }
  emit('update:modelValue', props.plain.includes(value) ? value : sortValueOf({ field: value, direction: direction.value }))
}

function flip() {
  emit('update:modelValue', sortValueOf({ field: field.value, direction: flipDirection(direction.value) }))
}
</script>

<template>
  <div class="flex items-center gap-1.5">
    <span
      v-if="!compact"
      class="text-sm text-muted"
    >{{ t('card.sort.label') }}</span>
    <USelect
      :model-value="field"
      :items="items"
      :aria-label="t('card.sort.label')"
      class="min-w-40"
      data-testid="card-sort-field"
      @update:model-value="pick"
    />
    <UButton
      v-if="!isPlain"
      color="neutral"
      variant="outline"
      square
      :icon="direction === 'asc' ? 'i-lucide-arrow-up-narrow-wide' : 'i-lucide-arrow-down-wide-narrow'"
      :aria-label="direction === 'asc' ? t('card.sort.ascending') : t('card.sort.descending')"
      :title="direction === 'asc' ? t('card.sort.switchToDescending') : t('card.sort.switchToAscending')"
      data-testid="card-sort-direction"
      @click="flip"
    />
  </div>
</template>
