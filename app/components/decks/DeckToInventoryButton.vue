<script setup lang="ts">
/**
 * "Zur Kartenliste": puts the cards of a deck into the inventory in one step (tester feedback, round 6).
 * A deck often holds cards the player owns in real life but never entered, or one imported from a list.
 * By default only the copies the inventory lacks are added, so pressing it twice changes nothing; "all"
 * adds every copy of the deck on top of what is there. Goes through the bulk endpoint of the quick entry.
 */
import { MAX_OWNED_QUANTITY } from '~~/shared/inventory'

interface DeckRow {
  catalogCardId: number
  quantity: number
  owned: number
}

const props = defineProps<{
  /** The rows of Main, Extra and Side; a card in two sections counts once with both quantities. */
  rows: DeckRow[]
}>()

const emit = defineEmits<{
  added: []
}>()

const { t } = useI18n()
const count = useCount()
const apiError = useApiError()
const toast = useToast()

const NO_COLLECTION = 'none'
const BULK_CHUNK = 200

const open = ref(false)
const mode = ref<'missing' | 'all'>('missing')
const collectionId = ref(NO_COLLECTION)
const collections = ref<Array<{ label: string, value: string }>>([])
const saving = ref(false)
const errorMessage = ref('')

const isEmpty = computed(() => props.rows.length === 0)

/** Per card: the copies in the whole deck and what the inventory owns. */
const cards = computed(() => {
  const byCard = new Map<number, { used: number, owned: number }>()
  for (const row of props.rows) {
    const known = byCard.get(row.catalogCardId)
    byCard.set(row.catalogCardId, { used: (known?.used ?? 0) + row.quantity, owned: Math.max(known?.owned ?? 0, row.owned) })
  }
  return [...byCard.entries()].map(([catalogCardId, value]) => ({ catalogCardId, ...value }))
})

const missingCopies = computed(() => cards.value.reduce((sum, card) => sum + Math.max(0, card.used - card.owned), 0))
const allCopies = computed(() => cards.value.reduce((sum, card) => sum + card.used, 0))

const items = computed(() => cards.value
  .map(card => ({
    catalog_card_id: card.catalogCardId,
    quantity: Math.min(MAX_OWNED_QUANTITY, mode.value === 'missing' ? card.used - card.owned : card.used),
    collection_id: collectionId.value === NO_COLLECTION ? null : collectionId.value,
  }))
  .filter(item => item.quantity > 0))

watch(open, async (isOpen) => {
  if (!isOpen) {
    return
  }
  errorMessage.value = ''
  // Nothing missing: offer "all" straight away instead of an empty default.
  mode.value = missingCopies.value > 0 ? 'missing' : 'all'
  try {
    const result = await $fetch<{ items: Array<{ id: string, name: string }> }>('/api/collections')
    collections.value = [
      { label: t('decks.toInventory.noCollection'), value: NO_COLLECTION },
      ...result.items.map(item => ({ label: item.name, value: item.id })),
    ]
  }
  catch {
    collections.value = [{ label: t('decks.toInventory.noCollection'), value: NO_COLLECTION }]
  }
})

async function submit() {
  if (items.value.length === 0) {
    return
  }
  saving.value = true
  errorMessage.value = ''
  try {
    let created = 0
    let merged = 0
    for (let start = 0; start < items.value.length; start += BULK_CHUNK) {
      const result = await $fetch<{ created: number, merged: number }>('/api/inventory/bulk', {
        method: 'POST',
        body: { items: items.value.slice(start, start + BULK_CHUNK) },
      })
      created += result.created
      merged += result.merged
    }
    toast.add({
      title: t('decks.toInventory.done', { copies: items.value.reduce((sum, item) => sum + item.quantity, 0), cards: items.value.length }),
      description: t('decks.toInventory.doneDetail', { created, merged }),
      color: 'success',
    })
    open.value = false
    emit('added')
  }
  catch (error) {
    errorMessage.value = apiError(error, 'decks.toInventory.failed')
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <!-- One root ("contents" keeps the button a direct flex child of the toolbar), so the component can be mounted on its own. -->
  <div class="contents">
  <UButton
    icon="i-lucide-package-plus"
    color="neutral"
    variant="outline"
    :label="t('decks.toInventory.button')"
    :disabled="isEmpty"
    :title="isEmpty ? t('decks.export.empty') : t('decks.toInventory.hint')"
    @click="open = true"
  />

  <UModal
    v-model:open="open"
    :title="t('decks.toInventory.title')"
    :description="t('decks.toInventory.description')"
  >
    <template #body>
      <div class="space-y-4">
        <div class="space-y-2">
          <label
            class="flex cursor-pointer items-start gap-3 rounded-lg border border-default p-3"
            :class="mode === 'missing' ? 'border-primary bg-primary/5' : ''"
          >
            <input
              v-model="mode"
              type="radio"
              name="deck-to-inventory-mode"
              class="mt-1"
              value="missing"
              :disabled="missingCopies === 0"
            >
            <span class="space-y-0.5">
              <span class="block text-sm font-medium text-highlighted">{{ t('decks.toInventory.missing.label') }}</span>
              <span class="block text-xs text-muted">
                {{ missingCopies === 0 ? t('decks.toInventory.missing.none') : count('decks.toInventory.missing.copies', missingCopies) }}
              </span>
            </span>
          </label>
          <label
            class="flex cursor-pointer items-start gap-3 rounded-lg border border-default p-3"
            :class="mode === 'all' ? 'border-primary bg-primary/5' : ''"
          >
            <input
              v-model="mode"
              type="radio"
              name="deck-to-inventory-mode"
              class="mt-1"
              value="all"
            >
            <span class="space-y-0.5">
              <span class="block text-sm font-medium text-highlighted">{{ t('decks.toInventory.all.label') }}</span>
              <span class="block text-xs text-muted">{{ count('decks.toInventory.all.copies', allCopies) }}</span>
            </span>
          </label>
        </div>

        <UFormField
          v-if="collections.length > 1"
          :label="t('decks.toInventory.collection')"
        >
          <USelect
            v-model="collectionId"
            :items="collections"
            :aria-label="t('decks.toInventory.collection')"
            class="w-full"
          />
        </UFormField>

        <p
          v-if="errorMessage"
          role="alert"
          class="text-sm text-error"
        >
          {{ errorMessage }}
        </p>

        <div class="flex justify-end gap-2">
          <UButton
            type="button"
            color="neutral"
            variant="ghost"
            :label="t('common.cancel')"
            @click="open = false"
          />
          <UButton
            :label="t('decks.toInventory.submit')"
            :loading="saving"
            :disabled="items.length === 0"
            @click="submit"
          />
        </div>
      </div>
    </template>
  </UModal>
  </div>
</template>
