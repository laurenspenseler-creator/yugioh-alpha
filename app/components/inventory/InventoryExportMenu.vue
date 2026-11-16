<script setup lang="ts">
/**
 * "Exportieren": the inventory as an Excel table, a Word document or a text list. It exports what the
 * list shows (the same collection, search and filters) with every page, not just the one on the screen: the server sends all the
 * rows (`GET /api/inventory/export`), the browser writes the file in its own language and hands it to the download (ADR 0051).
 * The encoders are pure (`shared/inventory-export.ts`), like the deck export's.
 */
import { encodeInventoryExport, INVENTORY_EXPORT_MIME, inventoryExportFileName } from '~~/shared/inventory-export'
import type { InventoryExportDocument, InventoryExportFormat, InventoryExportRow } from '~~/shared/inventory-export'
import { inventoryExportGroups, inventoryExportTotals } from '~/utils/inventory-export'

const props = defineProps<{
  /** What the list is scoped to, as the page names it: "Alle Karten", a collection's name. */
  scope: string
  /** The search and filters of the list, as the query of `GET /api/inventory`; paging and sorting don't matter. */
  query: Record<string, unknown>
  /** Whether a search or a filter narrows the list (said in the file). */
  filtered: boolean
  disabled?: boolean
}>()

const { t, locale } = useI18n()
const { cardName, englishName, cardValue, cardLevelLabel } = useCardText()
const count = useCount()
const toast = useToast()

const isExporting = ref(false)

function localDay(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function buildDocument(rows: readonly InventoryExportRow[], date: Date): InventoryExportDocument {
  const { copies, kinds } = inventoryExportTotals(rows)
  const subtitle = [
    count('inventory.cardCount', copies),
    count('inventory.export.kinds', kinds),
    props.filtered ? t('inventory.export.filtered') : null,
    t('inventory.export.asOf', { date: new Intl.DateTimeFormat(locale.value, { dateStyle: 'long' }).format(date) }),
  ].filter(Boolean).join(' · ')

  return {
    title: t('inventory.export.title', { scope: props.scope }),
    subtitle,
    lang: locale.value === 'de' ? 'de-DE' : 'en-US',
    labels: {
      sheet: t('inventory.export.sheet'),
      quantity: t('inventory.export.columns.quantity'),
      name: t('inventory.export.columns.name'),
      englishName: t('inventory.export.columns.englishName'),
      collection: t('inventory.export.columns.collection'),
      type: t('inventory.export.columns.type'),
      attribute: t('inventory.export.columns.attribute'),
      race: t('inventory.export.columns.race'),
      level: t('inventory.export.columns.level'),
      atk: t('inventory.export.columns.atk'),
      def: t('inventory.export.columns.def'),
      passcode: t('inventory.export.columns.passcode'),
      note: t('inventory.export.columns.note'),
    },
    groups: inventoryExportGroups(rows, {
      cardName,
      englishName,
      cardValue,
      levelLabel: cardLevelLabel,
      noCollection: t('inventory.breakdown.noCollection'),
      heading: (name, copies) => `${name} · ${count('inventory.cardCount', copies)}`,
    }),
  }
}

function download(name: string, content: BlobPart, mime: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  URL.revokeObjectURL(url)
}

async function exportAs(format: InventoryExportFormat) {
  if (isExporting.value) {
    return
  }
  isExporting.value = true
  try {
    const { items, truncated } = await $fetch<{ items: InventoryExportRow[], truncated: boolean }>('/api/inventory/export', {
      query: props.query,
    })
    if (items.length === 0) {
      toast.add({ title: t('inventory.export.empty'), color: 'warning' })
      return
    }
    const now = new Date()
    const name = inventoryExportFileName(props.scope, localDay(now), format, t('inventory.export.fileStem'))
    download(name, encodeInventoryExport(format, buildDocument(items, now)), INVENTORY_EXPORT_MIME[format])
    toast.add({ title: t('inventory.export.toast.downloaded', { name }), color: 'success' })
    if (truncated) {
      toast.add({ title: t('inventory.export.toast.truncated', { count: items.length }), color: 'warning' })
    }
  }
  catch {
    toast.add({ title: t('inventory.export.errors.failed'), color: 'error' })
  }
  finally {
    isExporting.value = false
  }
}

const items = computed(() => [
  [
    { type: 'label' as const, label: t('inventory.export.hint') },
  ],
  [
    { label: t('inventory.export.formats.xlsx'), icon: 'i-lucide-file-spreadsheet', onSelect: () => exportAs('xlsx') },
    { label: t('inventory.export.formats.docx'), icon: 'i-lucide-file-text', onSelect: () => exportAs('docx') },
    { label: t('inventory.export.formats.txt'), icon: 'i-lucide-align-left', onSelect: () => exportAs('txt') },
  ],
])
</script>

<template>
  <UDropdownMenu
    :items="items"
    :content="{ align: 'end' }"
  >
    <UButton
      icon="i-lucide-file-down"
      trailing-icon="i-lucide-chevron-down"
      color="neutral"
      variant="outline"
      :label="t('inventory.export.menu')"
      :loading="isExporting"
      :disabled="disabled"
      :title="disabled ? t('inventory.export.empty') : undefined"
      data-testid="inventory-export"
    />
  </UDropdownMenu>
</template>
