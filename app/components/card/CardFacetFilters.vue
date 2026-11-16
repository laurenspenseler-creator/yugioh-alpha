<script setup lang="ts">
import { CARD_KINDS, SPELL_TRAP_RACES, spellTrapRaces } from '~~/shared/card-kind'
import type { CardKind } from '~~/shared/card-kind'

/**
 * The card facet menus (kind, type, attribute, race, level), shared by the
 * catalog and the inventory so both filter the same way (#63), and by the
 * format editor's card filter (#120).
 *
 * - Multi-select; an empty array means "no filter".
 * - "Kartenart" (`kind`) is the grouped filter by frame, "Typ" the exact type
 *   line below it (shared/card-kind.ts); leave out `v-model:kind` to hide it.
 * - "Ohne Kartenart" (`exclude-kind`, tester feedback round 12) is the same list the other way round: the cards must not
 *   be of these kinds (no Pendulum, no Link, ...). Leave out `v-model:exclude-kind` to hide it. A kind is in one of the
 *   two menus at a time: picking it in one takes it out of the other.
 * - With a `kind` the menus follow it (tester feedback: too much monster, too little Spell and Trap): when only Spell
 *   and/or Trap are picked, Typ, Attribut and Stufe (which mean nothing for them) give way to one menu with the
 *   subtypes (Normal, Schnell, Permanent, Ausrüstung, Spielfeld, Ritual, Konter); otherwise "Monsterart" lists only the
 *   monsters' races. A value that is picked stays in its menu, so no filter is ever active without being visible.
 * - Multi-root (no wrapper): the parent's grid or flex places the menus, and
 *   `menuClass` sets their width (a multi-root component doesn't inherit `class`).
 * - Leave out `v-model:level` to hide the level menu (the format editor
 *   filters levels by range).
 * - `disabled` disables every menu (a read-only built-in format).
 */
export interface CardFacetOptions {
  types: string[]
  attributes: string[]
  races: string[]
  levels: number[]
  /** The "Deckthema" menu (`CardArchetypeFilter`, which the catalog and the inventory place themselves); optional. */
  archetypes?: string[]
}

const props = withDefaults(defineProps<{
  facets: CardFacetOptions
  /** Width classes for each menu; the parent's grid/flex places them. */
  menuClass?: string
  disabled?: boolean
}>(), { menuClass: 'w-full min-w-0', disabled: false })

// The cross of a menu (clear, tester feedback, round 16: every filter can be reset on its own) leaves nothing, not undefined;
// a model that is left out stays undefined (that menu is hidden).
const kind = defineModel<CardKind[]>('kind', { set: value => value ?? [] })
const excludeKind = defineModel<CardKind[]>('excludeKind', { set: value => value ?? [] })
const type = defineModel<string[]>('type', { required: true, set: value => value ?? [] })
const attribute = defineModel<string[]>('attribute', { required: true, set: value => value ?? [] })
const race = defineModel<string[]>('race', { required: true, set: value => value ?? [] })
const level = defineModel<number[]>('level', { set: value => value ?? [] })

const { t } = useI18n()
const { cardValueOptions } = useCardText()

/** The plain Spell or Trap, listed first in the subtype menu. */
const NORMAL_SUBTYPE = 'Normal'

// Filter values stay English (the APIs filter on them); labels follow the card language (ADR 0015).
const kindItems = computed(() => CARD_KINDS.map(value => ({ label: t(`card.kind.${value}`), value })))
const typeItems = computed(() => cardValueOptions('type', props.facets.types))
// Each attribute carries its symbol (tester feedback, round 11).
const attributeItems = computed(() => cardValueOptions('attribute', props.facets.attributes)
  .map(item => ({ ...item, icon: attributeIcon(item.value) })))
const levelItems = computed(() => props.facets.levels.map(value => ({ label: t('card.levelFilterOption', { value }), value })))

/**
 * What the picked kinds are: no `kind` model at all (the menus stay as they are), nothing picked or only monsters, only
 * Spells and/or Traps, or a mix of both.
 */
const scope = computed<'plain' | 'monster' | 'spellTrap' | 'mixed'>(() => {
  const picked = kind.value
  if (picked === undefined) {
    return 'plain'
  }
  const spellTrap = picked.filter(value => value === 'spell' || value === 'trap').length
  if (spellTrap === 0) {
    return 'monster'
  }
  return spellTrap === picked.length ? 'spellTrap' : 'mixed'
})

/**
 * The race values to offer: the monsters' races, the subtypes of the picked Spells and Traps, or all of them. The
 * subtypes are the game's own list, always whole (tester feedback: "Spielfeld" and "Ritual" were missing because the
 * inventory only knew the ones the player happened to own), so they do not depend on the facets.
 */
const raceValues = computed(() => {
  const all = props.facets.races
  if (scope.value === 'spellTrap') {
    return spellTrapRaces(kind.value ?? [])
  }
  if (scope.value === 'monster') {
    return all.filter(value => !SPELL_TRAP_RACES.includes(value))
  }
  return all
})
// Each subtype carries the symbol of the card frame (infinity, plus, lightning, ...), the Normal one has none. "Normal"
// is the plain one and leads the list (tester feedback), the others follow in the order of their names.
const raceItems = computed(() => cardValueOptions('race', [...new Set([...raceValues.value, ...race.value])])
  .map(item => ({ ...item, icon: spellTrapIcon(item.value) }))
  .sort((a, b) => Number(b.value === NORMAL_SUBTYPE) - Number(a.value === NORMAL_SUBTYPE)))

const raceLabel = computed(() => {
  if (scope.value === 'spellTrap') {
    const picked = kind.value ?? []
    return t(picked.includes('spell') && picked.includes('trap') ? 'card.field.raceSpellTrap' : picked.includes('spell') ? 'card.field.raceSpell' : 'card.field.raceTrap')
  }
  return t(scope.value === 'mixed' ? 'card.field.raceAny' : 'card.field.race')
})

// Spells and Traps have no exact type to choose from, no attribute and no level: those menus step aside, unless a value
// is still picked in them (an old link), which keeps it visible.
const showType = computed(() => scope.value !== 'spellTrap' || type.value.length > 0)
const showAttribute = computed(() => scope.value !== 'spellTrap' || attribute.value.length > 0)
const showLevel = computed(() => level.value !== undefined && (scope.value !== 'spellTrap' || level.value.length > 0))

// A kind is wanted or unwanted, never both: the menu that was touched last wins.
watch(() => kind.value && [...kind.value], (picked) => {
  if (picked && excludeKind.value?.some(value => picked.includes(value))) {
    excludeKind.value = excludeKind.value.filter(value => !picked.includes(value))
  }
})
watch(() => excludeKind.value && [...excludeKind.value], (picked) => {
  if (picked && kind.value?.some(value => picked.includes(value))) {
    kind.value = kind.value.filter(value => !picked.includes(value))
  }
})

// Changing the kinds takes along what no longer fits: the monster menus are emptied for Spells and Traps, and the
// values of the other group (a subtype, or a monster race) are dropped from the race menu.
watch(() => kind.value && [...kind.value], () => {
  if (scope.value === 'spellTrap') {
    type.value = []
    attribute.value = []
    if (level.value !== undefined) {
      level.value = []
    }
    const wanted = spellTrapRaces(kind.value ?? [])
    if (race.value.some(value => !wanted.includes(value))) {
      race.value = race.value.filter(value => wanted.includes(value))
    }
  }
  else if (scope.value === 'monster' && race.value.some(value => SPELL_TRAP_RACES.includes(value))) {
    race.value = race.value.filter(value => !SPELL_TRAP_RACES.includes(value))
  }
})
</script>

<template>
  <USelectMenu
    v-if="kind !== undefined"
    v-model="kind"
    multiple
    clear
    value-key="value"
    :items="kindItems"
    :disabled="disabled"
    :placeholder="t('card.field.kind')"
    :aria-label="t('card.field.kind')"
    :class="menuClass"
  />
  <USelectMenu
    v-if="excludeKind !== undefined"
    v-model="excludeKind"
    multiple
    clear
    value-key="value"
    :items="kindItems"
    :disabled="disabled"
    :placeholder="t('card.field.excludeKind')"
    :aria-label="t('card.field.excludeKind')"
    :class="menuClass"
  />
  <USelectMenu
    v-if="showType"
    v-model="type"
    multiple
    clear
    value-key="value"
    :items="typeItems"
    :disabled="disabled"
    :placeholder="t('card.field.type')"
    :aria-label="t('card.field.type')"
    :class="menuClass"
  />
  <USelectMenu
    v-if="showAttribute"
    v-model="attribute"
    multiple
    clear
    value-key="value"
    :items="attributeItems"
    :disabled="disabled"
    :placeholder="t('card.field.attribute')"
    :aria-label="t('card.field.attribute')"
    :class="menuClass"
  />
  <USelectMenu
    v-model="race"
    multiple
    clear
    value-key="value"
    :items="raceItems"
    :disabled="disabled"
    :placeholder="raceLabel"
    :aria-label="raceLabel"
    :class="menuClass"
  />
  <USelectMenu
    v-if="showLevel"
    v-model="level"
    multiple
    clear
    value-key="value"
    :items="levelItems"
    :disabled="disabled"
    :placeholder="t('card.field.level')"
    :aria-label="t('card.field.level')"
    :class="menuClass"
  />
</template>
