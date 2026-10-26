<script setup lang="ts">
import {
  MAX_ENTRY_LINES,
  MAX_ENTRY_ROWS,
  createEntryRows,
} from '~/utils/card-entry'
import type { EntryRow, EntrySuggestResult } from '~/utils/card-entry'
import { countEntryLines } from '~~/shared/decklist'
import { appendCardLines } from '~/utils/card-lines'
import { mergeSavedCopies } from '~/utils/saved-copies'
import type { SavedCopy } from '~/utils/saved-copies'
import { readCardCandidates, SPREADSHEET_MAX_LINES, SpreadsheetError } from '~/utils/spreadsheet-list'
import type { SheetCandidate } from '~/utils/spreadsheet-list'

usePageTitle('quickEntry.title')

const { t, n } = useI18n()
const apiError = useApiError()

const toast = useToast()
const route = useRoute()

const rows = ref<EntryRow[]>([])
const isSuggesting = ref(false)
const errorMessage = ref('')
const warningMessage = ref('')

// Deep-link from /inventory?collectionId=… so the Standardwerte panel starts
// on the collection the user was just looking at.
const presetCollectionId = computed(() => {
  const value = route.query.collectionId
  return typeof value === 'string' && value !== '' ? value : null
})

// The shared collections fetch (`useCollections`): creating a collection in the
// "gerade gespeichert" panel refreshes it for everyone.
const { data: collectionsData } = await useCollections()
const collections = computed(() => collectionsData.value?.items ?? [])

async function requestSuggestions(body: { text?: string, items?: string[] }) {
  isSuggesting.value = true
  errorMessage.value = ''
  warningMessage.value = ''

  try {
    const response = await $fetch<{ results: EntrySuggestResult[] }>('/api/inventory/entry/suggest', {
      method: 'POST',
      body,
    })

    const free = Math.max(0, MAX_ENTRY_ROWS - rows.value.length)
    const accepted = response.results.slice(0, free)
    const dropped = response.results.length - accepted.length
    if (dropped > 0) {
      warningMessage.value = t('quickEntry.queueFull.description', {
        max: n(MAX_ENTRY_ROWS, 'integer'),
        dropped: n(dropped, 'integer'),
      }, dropped)
    }

    rows.value = [...rows.value, ...createEntryRows(accepted)]
    return accepted.length
  }
  catch (error) {
    errorMessage.value = apiError(error, 'quickEntry.errors.suggestFailed')
    return 0
  }
  finally {
    isSuggesting.value = false
  }
}

// --- Liste -----------------------------------------------------------------

// Input syntax samples: card names and codes, the same in every language.
const LIST_PLACEHOLDER = ['3x Dark Magician', 'Pot of Greed', 'Dark Magician (SDY-006)', '46986414'].join('\n')
const LIST_EXAMPLES = ['3x Dark Magician', 'Dark Magician x3', 'Dark Magician (SDY-006)', 'SDY-006', '46986414']
  .map((text, index, all) => ({ text, separator: index < all.length - 1 ? ', ' : '' }))

const listText = ref('')

// Distinct card lines: a pasted YDK has one line per copy, and headers and comments are no cards.
const listLineCount = computed(() => countEntryLines(listText.value))
const tooManyLines = computed(() => listLineCount.value > MAX_ENTRY_LINES)

async function submitList() {
  if (listText.value.trim() === '') {
    errorMessage.value = t('quickEntry.errors.empty')
    return
  }
  if (tooManyLines.value) {
    errorMessage.value = t('quickEntry.errors.tooManyLines', { max: n(MAX_ENTRY_LINES, 'integer') })
    return
  }

  const count = await requestSuggestions({ text: listText.value })
  if (count > 0) {
    listText.value = ''
  }
}

// --- Datei -----------------------------------------------------------------

// An Excel / CSV / text file read in the browser into card lines. The review
// queue holds MAX_ENTRY_ROWS rows, so a long file goes in step by step.
const FILE_ACCEPT = '.xlsx,.xlsm,.csv,.tsv,.txt,.ydk'

const fileInput = useTemplateRef<HTMLInputElement>('fileInput')
const fileLines = ref<string[]>([])
const fileInfo = ref<{ name: string, total: number, skipped: number, truncated: boolean } | null>(null)
const isReadingFile = ref(false)

const queueFull = computed(() => rows.value.length >= MAX_ENTRY_ROWS)
const fileNotes = computed(() => {
  const info = fileInfo.value
  if (!info) {
    return []
  }
  const remaining = fileLines.value.length
  return [
    remaining > 0 ? t('quickEntry.file.remaining', { count: n(remaining, 'integer') }, remaining) : '',
    info.skipped > 0 ? t('quickEntry.file.skipped', { count: n(info.skipped, 'integer') }, info.skipped) : '',
    info.truncated ? t('quickEntry.file.truncated', { max: n(SPREADSHEET_MAX_LINES, 'integer') }) : '',
    remaining > 0 && queueFull.value ? t('quickEntry.file.queueFirst') : '',
  ].filter(note => note !== '')
})

async function loadFileLines() {
  while (fileLines.value.length > 0 && rows.value.length < MAX_ENTRY_ROWS) {
    const take = Math.min(MAX_ENTRY_LINES, MAX_ENTRY_ROWS - rows.value.length, fileLines.value.length)
    await requestSuggestions({ text: fileLines.value.slice(0, take).join('\n') })
    if (errorMessage.value !== '') {
      // The lines stay, so "Nächste Zeilen laden" can try again.
      return
    }
    fileLines.value = fileLines.value.slice(take)
  }
}

function startFile(name: string, result: SheetCandidate) {
  fileChoices.value = null
  fileLines.value = result.lines
  // A workbook with several sheets: say which one the cards came from.
  fileInfo.value = {
    name: result.sheetName ? `${name} · ${result.sheetName}` : name,
    total: result.lines.length,
    skipped: result.skipped,
    truncated: result.truncated,
  }
  return loadFileLines()
}

// A workbook with several card sheets: the user picks one, nothing is read before.
const fileChoices = ref<{ name: string, candidates: SheetCandidate[] } | null>(null)

function offerFile(name: string, candidates: SheetCandidate[]) {
  if (candidates.length === 1) {
    return startFile(name, candidates[0]!)
  }
  fileLines.value = []
  fileInfo.value = null
  fileChoices.value = { name, candidates }
  return Promise.resolve()
}

async function onListFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  // So the same file can be picked again after it was changed.
  input.value = ''
  if (!file) {
    return
  }

  errorMessage.value = ''
  isReadingFile.value = true
  try {
    await offerFile(file.name, await readCardCandidates(file, file.name))
  }
  catch (error) {
    fileLines.value = []
    fileInfo.value = null
    fileChoices.value = null
    errorMessage.value = t(`quickEntry.file.errors.${error instanceof SpreadsheetError ? error.code : 'unreadable'}`)
  }
  finally {
    isReadingFile.value = false
  }
}

// --- Fotos und Sprache -----------------------------------------------------

// Cards read from photos (ADR 0040) go into the review table like a file's lines.
function onPhotoLines(result: { lines: string[] }) {
  return startFile(t('quickEntry.photo.sourceName'), { lines: result.lines, skipped: 0, header: false, sheetName: null, truncated: false })
}

// Cards said aloud join the list, so they can be corrected before "Karten erkennen".
function onSpokenLines(lines: string[]) {
  listText.value = appendCardLines(listText.value, lines)
  errorMessage.value = ''
}

// A file the user chose on /inventory/files ("Karten importieren").
const handoff = useQuickEntryHandoff()
onMounted(async () => {
  const pending = handoff.value
  if (pending) {
    handoff.value = null
    await offerFile(pending.name, pending.candidates)
  }
})

// --- Speichern -------------------------------------------------------------

// What was saved so far, to move to another collection (EntryJustSavedPanel).
// The review table empties on save; this does not feed it, so nothing is
// written twice.
const justSaved = ref<SavedCopy[]>([])
const justSavedPanel = useTemplateRef<{ focus: () => void }>('justSavedPanel')

async function onSavedCopies(copies: SavedCopy[]) {
  justSaved.value = mergeSavedCopies(justSaved.value, copies)
  await nextTick()
  justSavedPanel.value?.focus()
}

function onSaved(result: { created: number, merged: number }) {
  toast.add({
    title: t('quickEntry.toast.saved.title'),
    description: t('quickEntry.toast.saved.description', { created: n(result.created, 'integer'), merged: n(result.merged, 'integer') }),
    icon: 'i-lucide-check',
    color: 'success',
  })
}
</script>

<template>
  <div class="space-y-6">
    <div class="space-y-2">
      <LayoutBackLink
        :to="{ path: '/inventory', query: presetCollectionId ? { collectionId: presetCollectionId } : {} }"
        :label="t('quickEntry.backToInventory')"
      />
      <LayoutPageHeader
        :title="t('quickEntry.title')"
        :description="t('quickEntry.description')"
      />
    </div>

    <UAlert
      color="neutral"
      variant="subtle"
      icon="i-lucide-sparkles"
      :title="t('quickEntry.assistantHint.title')"
      :description="t('quickEntry.assistantHint.description')"
    >
      <template #actions>
        <UButton
          to="/assistant"
          size="xs"
          color="neutral"
          variant="outline"
          :label="t('quickEntry.assistantHint.cta')"
          class="tap-target"
        />
      </template>
    </UAlert>

    <div class="panel p-4">
      <div class="space-y-3">
        <UFormField
          :label="t('quickEntry.list.label')"
          :description="t('quickEntry.list.description')"
        >
          <UTextarea
            v-model="listText"
            :rows="8"
            class="w-full"
            :aria-label="t('quickEntry.list.label')"
            :placeholder="LIST_PLACEHOLDER"
          />
        </UFormField>

        <p class="text-xs text-muted">
          {{ t('quickEntry.list.examples') }}
          <template
            v-for="example in LIST_EXAMPLES"
            :key="example.text"
          >
            <span class="font-mono">{{ example.text }}</span>{{ example.separator }}
          </template>
        </p>

        <p
          v-if="tooManyLines"
          class="text-xs text-warning"
        >
          {{ t('quickEntry.list.tooManyLines', { count: n(listLineCount, 'integer'), max: n(MAX_ENTRY_LINES, 'integer') }) }}
        </p>

        <UButton
          icon="i-lucide-scan-text"
          :label="t('quickEntry.list.submit')"
          :loading="isSuggesting"
          :disabled="tooManyLines"
          @click="submitList"
        />

        <div class="flex flex-wrap items-center gap-3 border-t border-default pt-3">
          <input
            ref="fileInput"
            type="file"
            class="sr-only"
            tabindex="-1"
            :accept="FILE_ACCEPT"
            :aria-label="t('quickEntry.file.button')"
            @change="onListFile"
          >
          <UButton
            icon="i-lucide-file-spreadsheet"
            color="neutral"
            variant="outline"
            :label="t('quickEntry.file.button')"
            :loading="isReadingFile"
            @click="() => fileInput?.click()"
          />
          <p class="min-w-0 flex-1 basis-64 text-xs text-muted">
            {{ t('quickEntry.file.hint') }}
          </p>
        </div>

        <!-- Photos go straight to the review table; dictation writes into the list above. -->
        <div class="border-t border-default pt-3">
          <CardsPhotoImport @lines="onPhotoLines" />
        </div>
        <div class="border-t border-default pt-3">
          <CardsSpeechInput @lines="onSpokenLines" />
        </div>
      </div>
    </div>

    <UAlert
      v-if="fileChoices"
      color="neutral"
      variant="subtle"
      icon="i-lucide-file-spreadsheet"
      :title="t('quickEntry.file.chooseTitle', { name: fileChoices.name })"
      :description="t('quickEntry.file.chooseDescription')"
    >
      <template #actions>
        <UButton
          v-for="candidate in fileChoices.candidates"
          :key="candidate.sheetName ?? ''"
          size="xs"
          color="neutral"
          variant="outline"
          class="tap-target"
          :label="t('quickEntry.file.sheetOption', { sheet: candidate.sheetName, count: n(candidate.lines.length, 'integer') }, candidate.lines.length)"
          :loading="isSuggesting"
          @click="startFile(fileChoices.name, candidate)"
        />
      </template>
    </UAlert>

    <UAlert
      v-if="fileInfo"
      color="neutral"
      variant="subtle"
      icon="i-lucide-file-spreadsheet"
      :title="t('quickEntry.file.summary', { name: fileInfo.name, count: n(fileInfo.total, 'integer') }, fileInfo.total)"
      :description="fileNotes.join(' ')"
    >
      <template #actions>
        <UButton
          v-if="fileLines.length > 0"
          size="xs"
          color="neutral"
          variant="outline"
          class="tap-target"
          :label="t('quickEntry.file.loadMore')"
          :loading="isSuggesting"
          :disabled="queueFull"
          @click="loadFileLines"
        />
      </template>
    </UAlert>

    <UAlert
      v-if="errorMessage"
      color="error"
      variant="subtle"
      :title="t('quickEntry.errors.title')"
      :description="errorMessage"
    />

    <UAlert
      v-if="warningMessage"
      color="warning"
      variant="subtle"
      :title="t('quickEntry.queueFull.title')"
      :description="warningMessage"
    />

    <div
      v-if="rows.length > 0"
      class="space-y-4"
    >
      <h2 class="text-lg font-semibold text-highlighted">
        {{ t('quickEntry.review.title') }}
      </h2>
      <EntryReviewTable
        v-model:rows="rows"
        :collections="collections"
        :preset-collection-id="presetCollectionId"
        @saved="onSaved"
        @saved-copies="onSavedCopies"
      />
    </div>
    <p
      v-else-if="!isSuggesting"
      class="text-sm text-muted"
    >
      {{ t('quickEntry.review.nothingYet') }}
    </p>

    <EntryJustSavedPanel
      v-if="justSaved.length > 0"
      ref="justSavedPanel"
      v-model:copies="justSaved"
      :collections="collections"
    />
  </div>
</template>
