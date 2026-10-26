<script setup lang="ts">
/**
 * /inventory/files: files the user keeps with their inventory (ADR 0033).
 * Upload by choosing or dropping files, open or download them again, delete
 * them. The files are private; the server is `/api/inventory/files`.
 */
import {
  INVENTORY_FILE_MAX_BYTES,
  INVENTORY_FILE_MAX_PER_UPLOAD,
  INVENTORY_FILE_MAX_TOTAL_BYTES,
} from '~~/shared/inventory-files'
import type { InventoryFilesResponse, InventoryFileView } from '~~/shared/inventory-files'
import { fileIcon, formatBytes } from '~/utils/inventory-files'
import { isImportableFileName, readCardCandidates, SpreadsheetError } from '~/utils/spreadsheet-list'

usePageTitle('inventory.files.title')

const { t, n, d, locale } = useI18n()
const count = useCount()
const toast = useToast()
const apiError = useApiError()
const { confirm } = useConfirm()

const MAX_FILE_MB = INVENTORY_FILE_MAX_BYTES / (1024 * 1024)

// The look of a small outline/ghost UButton, for the plain download anchors.
const LINK_BUTTON = 'inline-flex min-h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-default transition-colors hover:bg-elevated focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary'

const { data, pending, error, refresh } = await useFetch<InventoryFilesResponse>('/api/inventory/files', {
  headers: import.meta.server ? useRequestHeaders(['cookie']) : undefined,
  default: () => ({ items: [], totalBytes: 0 }),
})

const items = computed(() => data.value?.items ?? [])
const usage = computed(() => t('inventory.files.usage', {
  used: formatBytes(data.value?.totalBytes ?? 0, locale.value),
  max: formatBytes(INVENTORY_FILE_MAX_TOTAL_BYTES, locale.value),
}))

const fileInput = ref<HTMLInputElement | null>(null)
const isUploading = ref(false)
const isDragging = ref(false)
const errorMessage = ref('')

async function upload(files: File[]) {
  if (files.length === 0 || isUploading.value) {
    return
  }
  errorMessage.value = ''

  const tooLarge = files.find(file => file.size > INVENTORY_FILE_MAX_BYTES)
  if (tooLarge) {
    errorMessage.value = t('inventory.files.upload.tooLargeLocal', { name: tooLarge.name, max: n(MAX_FILE_MB, 'integer') })
    return
  }

  isUploading.value = true
  let uploaded = 0
  try {
    // Chunks keep a big selection under the server's per-request file limit.
    for (let start = 0; start < files.length; start += INVENTORY_FILE_MAX_PER_UPLOAD) {
      const body = new FormData()
      for (const file of files.slice(start, start + INVENTORY_FILE_MAX_PER_UPLOAD)) {
        body.append('file', file, file.name)
      }
      const response = await $fetch<{ items: InventoryFileView[] }>('/api/inventory/files', { method: 'POST', body })
      uploaded += response.items.length
    }
  }
  catch (uploadError) {
    errorMessage.value = apiError(uploadError, 'inventory.files.uploadFailed')
  }
  finally {
    isUploading.value = false
    if (fileInput.value) {
      fileInput.value.value = ''
    }
  }

  if (uploaded > 0) {
    toast.add({ title: t('inventory.files.upload.success', { count: n(uploaded, 'integer') }, uploaded), color: 'success' })
    await refresh()
  }
}

function onPick(event: Event) {
  upload(Array.from((event.target as HTMLInputElement).files ?? []))
}

function onDrop(event: DragEvent) {
  isDragging.value = false
  upload(Array.from(event.dataTransfer?.files ?? []))
}

async function remove(file: InventoryFileView) {
  const confirmed = await confirm({
    title: t('inventory.files.delete.title'),
    description: t('inventory.files.delete.description', { name: file.name }),
    confirmLabel: t('inventory.files.delete.confirm'),
    cancelLabel: t('inventory.files.delete.cancel'),
  })
  if (!confirmed) {
    return
  }

  errorMessage.value = ''
  try {
    await $fetch(`/api/inventory/files/${encodeURIComponent(file.id)}`, { method: 'DELETE' })
    toast.add({ title: t('inventory.files.delete.done'), color: 'success' })
    await refresh()
  }
  catch (deleteError) {
    errorMessage.value = apiError(deleteError, 'inventory.files.deleteFailed')
  }
}

// "Karten importieren": the stored file is read in the browser into card lines,
// which quick capture takes over for the review (the server never parses it).
const handoff = useQuickEntryHandoff()
const importingId = ref<string | null>(null)

async function importCards(file: InventoryFileView) {
  importingId.value = file.id
  errorMessage.value = ''
  try {
    const blob = await $fetch<Blob>(fileUrl(file, true), { responseType: 'blob' })
    handoff.value = { name: file.name, candidates: await readCardCandidates(blob, file.name) }
    await navigateTo('/inventory/quick-entry')
  }
  catch (importError) {
    errorMessage.value = importError instanceof SpreadsheetError
      ? t(`quickEntry.file.errors.${importError.code}`)
      : apiError(importError, 'inventory.files.importFailed')
  }
  finally {
    importingId.value = null
  }
}

// Cards read from photos open the quick capture's review table, like "Karten importieren".
async function onPhotoLines(result: { lines: string[] }) {
  handoff.value = {
    name: t('quickEntry.photo.sourceName'),
    candidates: [{ lines: result.lines, skipped: 0, header: false, sheetName: null, truncated: false }],
  }
  await navigateTo('/inventory/quick-entry')
}

function fileUrl(file: InventoryFileView, download = false): string {
  return `/api/inventory/files/${encodeURIComponent(file.id)}${download ? '?download=1' : ''}`
}
</script>

<template>
  <div class="space-y-6">
    <LayoutPageHeader
      :title="t('inventory.files.title')"
      :description="t('inventory.files.description')"
    >
      <template #actions>
        <UButton
          to="/inventory"
          icon="i-lucide-arrow-left"
          color="neutral"
          variant="outline"
          :label="t('inventory.files.back')"
        />
      </template>
    </LayoutPageHeader>

    <div
      :class="['panel flex flex-col items-center gap-3 border-2 border-dashed p-8 text-center transition-colors', isDragging ? 'border-primary bg-primary/5' : 'border-default']"
      @dragover.prevent="isDragging = true"
      @dragleave.prevent="isDragging = false"
      @drop.prevent="onDrop"
    >
      <UIcon
        name="i-lucide-upload"
        class="size-8 text-muted"
      />
      <p class="text-sm font-medium text-highlighted">
        {{ t('inventory.files.upload.dropzone') }}
      </p>
      <p class="text-xs text-muted">
        {{ t('inventory.files.upload.hint', { max: formatBytes(INVENTORY_FILE_MAX_BYTES, locale) }) }}
      </p>
      <input
        ref="fileInput"
        type="file"
        multiple
        class="sr-only"
        tabindex="-1"
        :aria-label="t('inventory.files.upload.label')"
        @change="onPick"
      >
      <UButton
        icon="i-lucide-file-up"
        :label="isUploading ? t('inventory.files.upload.uploading') : t('inventory.files.upload.label')"
        :loading="isUploading"
        :disabled="isUploading"
        @click="() => fileInput?.click()"
      />
    </div>

    <!-- Photos of cards are read into the quick capture's review table (ADR 0040); they are not stored. -->
    <section class="panel space-y-3 p-4">
      <div class="space-y-1">
        <h2 class="text-base font-semibold text-highlighted">
          {{ t('inventory.files.photos.title') }}
        </h2>
        <p class="text-sm text-muted">
          {{ t('inventory.files.photos.description') }}
        </p>
      </div>
      <CardsPhotoImport @lines="onPhotoLines" />
    </section>

    <UAlert
      v-if="errorMessage"
      color="error"
      variant="subtle"
      icon="i-lucide-circle-alert"
      :description="errorMessage"
    />

    <UAlert
      v-if="error"
      color="error"
      variant="subtle"
      icon="i-lucide-circle-alert"
      :description="t('inventory.files.loadFailed')"
    />

    <div
      v-if="pending"
      class="space-y-2"
    >
      <USkeleton
        v-for="skeleton in 3"
        :key="skeleton"
        class="h-16 w-full"
      />
    </div>

    <LayoutEmptyState
      v-else-if="items.length === 0"
      icon="i-lucide-folder-open"
      :title="t('inventory.files.empty.title')"
      :description="t('inventory.files.empty.description')"
    />

    <section
      v-else
      class="space-y-2"
      :aria-label="t('inventory.files.list.label')"
    >
      <p class="text-sm text-muted">
        {{ count('inventory.files.count', items.length) }} · {{ usage }}
      </p>

      <ul class="panel divide-y divide-default overflow-hidden">
        <li
          v-for="file in items"
          :key="file.id"
          class="flex flex-wrap items-center gap-3 p-3"
        >
          <UIcon
            :name="fileIcon(file.name)"
            class="size-6 shrink-0 text-muted"
          />

          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium text-highlighted">
              {{ file.name }}
            </p>
            <p class="text-xs text-muted">
              {{ formatBytes(file.size, locale) }} · {{ t('inventory.files.list.added', { date: d(new Date(file.createdAt), 'date') }) }}
            </p>
          </div>

          <div class="flex shrink-0 items-center gap-1">
            <UButton
              v-if="isImportableFileName(file.name)"
              icon="i-lucide-file-input"
              size="sm"
              :label="t('inventory.files.actions.importCards')"
              :aria-label="t('inventory.files.actions.importCardsLabel', { name: file.name })"
              :loading="importingId === file.id"
              :disabled="importingId !== null"
              @click="importCards(file)"
            />
            <!-- Plain anchors: these are server downloads, not app routes, and a
                 router link would try to resolve them as pages. -->
            <a
              v-if="file.openable"
              :href="fileUrl(file)"
              target="_blank"
              rel="noopener noreferrer"
              :class="[LINK_BUTTON, 'ring ring-inset ring-accented']"
              :aria-label="t('inventory.files.actions.openLabel', { name: file.name })"
            >
              <UIcon
                name="i-lucide-external-link"
                class="size-4"
              />
              {{ t('inventory.files.actions.open') }}
            </a>
            <a
              :href="fileUrl(file, true)"
              :class="[LINK_BUTTON, file.openable ? '' : 'ring ring-inset ring-accented']"
              :aria-label="t('inventory.files.actions.downloadLabel', { name: file.name })"
            >
              <UIcon
                name="i-lucide-download"
                class="size-4"
              />
              {{ t('inventory.files.actions.download') }}
            </a>
            <UButton
              icon="i-lucide-trash-2"
              color="error"
              variant="ghost"
              size="sm"
              :aria-label="t('inventory.files.actions.deleteLabel', { name: file.name })"
              @click="remove(file)"
            />
          </div>
        </li>
      </ul>
    </section>
  </div>
</template>
