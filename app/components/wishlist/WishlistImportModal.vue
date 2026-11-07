<script setup lang="ts">
/**
 * "Karten aus Liste hinzufügen" on the wishlist (tester feedback, round 7): a list of card lines (names with an optional
 * amount, set codes, passcodes, a pasted decklist) is matched against the catalog like the quick entry does, shown for a
 * check, and the cards that were recognised go onto the wishlist. A card that is already on the wishlist stays as it is
 * (its amount and note are not overwritten); a line that matches nothing or is not clear is shown and left out.
 */
import { MAX_ENTRY_LINES, createEntryRows, entryRowStatus } from '~/utils/card-entry'
import type { EntryRow, EntrySuggestResult } from '~/utils/card-entry'
import { countEntryLines } from '~~/shared/decklist'
import { MAX_WISHLIST_QUANTITY } from '~~/shared/sharing'

const open = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
  added: []
}>()

const { t, n } = useI18n()
const apiError = useApiError()
const toast = useToast()

const text = ref('')
const rows = ref<EntryRow[]>([])
const onWishlist = ref<Set<number>>(new Set())
const checking = ref(false)
const saving = ref(false)
const errorMessage = ref('')

const reviewing = computed(() => rows.value.length > 0)
const lineCount = computed(() => countEntryLines(text.value))

// Every time the dialog is opened it starts with an empty list.
watch(open, (isOpen) => {
  if (isOpen) {
    text.value = ''
    rows.value = []
    errorMessage.value = ''
  }
})

async function check() {
  errorMessage.value = ''
  if (text.value.trim() === '') {
    errorMessage.value = t('wishlist.import.empty')
    return
  }
  if (lineCount.value > MAX_ENTRY_LINES) {
    errorMessage.value = t('wishlist.import.tooManyLines', { max: n(MAX_ENTRY_LINES, 'integer') })
    return
  }
  checking.value = true
  try {
    const [suggested, ids] = await Promise.all([
      $fetch<{ results: EntrySuggestResult[] }>('/api/inventory/entry/suggest', { method: 'POST', body: { text: text.value } }),
      $fetch<{ ids: number[] }>('/api/wishlist/ids'),
    ])
    onWishlist.value = new Set(ids.ids)
    rows.value = createEntryRows(suggested.results)
  }
  catch (error) {
    errorMessage.value = apiError(error, 'wishlist.import.checkFailed')
  }
  finally {
    checking.value = false
  }
}

function candidateItems(row: EntryRow) {
  return row.candidates.slice(0, 5).map(candidate => ({
    label: candidate.nameDe ?? candidate.name,
    value: candidate.cardId,
  }))
}

function chosenName(row: EntryRow): string {
  const candidate = row.candidates.find(entry => entry.cardId === row.selectedCardId)
  return candidate ? (candidate.nameDe ?? candidate.name) : ''
}

/** A row goes onto the wishlist when a card is chosen for it and the card is not on the wishlist yet. */
const toAdd = computed(() => rows.value.filter(row => row.selectedCardId !== null && !onWishlist.value.has(row.selectedCardId)))
const alreadyThere = computed(() => rows.value.filter(row => row.selectedCardId !== null && onWishlist.value.has(row.selectedCardId)).length)
const skipped = computed(() => rows.value.filter(row => row.selectedCardId === null).length)

async function submit() {
  if (toAdd.value.length === 0) {
    return
  }
  saving.value = true
  errorMessage.value = ''
  let added = 0
  try {
    // One card twice in the list is one entry with both amounts.
    const amounts = new Map<number, number>()
    for (const row of toAdd.value) {
      amounts.set(row.selectedCardId!, Math.min(MAX_WISHLIST_QUANTITY, (amounts.get(row.selectedCardId!) ?? 0) + row.quantity))
    }
    for (const [catalogCardId, quantity] of amounts) {
      await $fetch('/api/wishlist', { method: 'POST', body: { catalogCardId, quantity } })
      added += 1
    }
    toast.add({ title: t('wishlist.import.done', { count: n(added, 'integer') }), color: 'success' })
    open.value = false
  }
  catch (error) {
    errorMessage.value = apiError(error, 'wishlist.import.failed')
  }
  finally {
    saving.value = false
    if (added > 0) {
      emit('added')
    }
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    :title="t('wishlist.import.title')"
    :description="t('wishlist.import.description')"
  >
    <template #body>
      <div class="space-y-4">
        <template v-if="!reviewing">
          <UTextarea
            v-model="text"
            :rows="9"
            :placeholder="t('wishlist.import.placeholder')"
            :aria-label="t('wishlist.import.label')"
            class="w-full"
          />
          <p class="text-xs text-muted">
            {{ t('wishlist.import.lines', { count: n(lineCount, 'integer'), max: n(MAX_ENTRY_LINES, 'integer') }) }}
          </p>
        </template>

        <template v-else>
          <ul
            class="divide-y divide-default rounded-lg border border-default"
            data-testid="wishlist-import-rows"
          >
            <li
              v-for="row in rows"
              :key="row.id"
              class="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm"
            >
              <span class="font-numeric w-8 shrink-0 text-muted">{{ row.quantity }}×</span>
              <div class="min-w-0 flex-1">
                <template v-if="entryRowStatus(row) === 'sicher'">
                  <span class="text-highlighted">{{ chosenName(row) }}</span>
                  <UBadge
                    v-if="row.selectedCardId !== null && onWishlist.has(row.selectedCardId)"
                    class="ml-1.5"
                    size="sm"
                    color="neutral"
                    variant="subtle"
                    :label="t('wishlist.import.row.onList')"
                  />
                </template>
                <USelect
                  v-else-if="entryRowStatus(row) === 'unsicher'"
                  :model-value="row.selectedCardId ?? undefined"
                  :items="candidateItems(row)"
                  :placeholder="t('wishlist.import.row.pick')"
                  :aria-label="t('wishlist.import.row.pickFor', { line: row.raw })"
                  class="w-full"
                  @update:model-value="(value: number) => { row.selectedCardId = value }"
                />
                <span
                  v-else
                  class="text-muted"
                >{{ row.raw }} – {{ t('wishlist.import.row.noMatch') }}</span>
              </div>
            </li>
          </ul>
          <p class="text-xs text-muted">
            {{ t('wishlist.import.summary', { add: n(toAdd.length, 'integer'), there: n(alreadyThere, 'integer'), skipped: n(skipped, 'integer') }) }}
          </p>
        </template>

        <p
          v-if="errorMessage"
          role="alert"
          class="text-sm text-error"
        >
          {{ errorMessage }}
        </p>
      </div>
    </template>

    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton
          v-if="reviewing"
          color="neutral"
          variant="ghost"
          :label="t('wishlist.import.back')"
          @click="rows = []"
        />
        <UButton
          color="neutral"
          variant="ghost"
          :label="t('common.cancel')"
          @click="open = false"
        />
        <UButton
          v-if="!reviewing"
          :label="t('wishlist.import.check')"
          :loading="checking"
          @click="check"
        />
        <UButton
          v-else
          :label="t('wishlist.import.submit')"
          :loading="saving"
          :disabled="toAdd.length === 0"
          @click="submit"
        />
      </div>
    </template>
  </UModal>
</template>
