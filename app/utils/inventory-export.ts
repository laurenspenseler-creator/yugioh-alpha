// The rows the server sends for an export (`GET /api/inventory/export`) as the document the file encoders write
// (shared/inventory-export.ts): grouped by collection, every word in the card language. The words come in as functions, so this
// stays pure and testable; `InventoryExportMenu.vue` passes the i18n ones.
import type { CardNameFields } from '~~/shared/card-text'
import type { ExportStat, InventoryExportCard, InventoryExportGroup, InventoryExportRow } from '~~/shared/inventory-export'
import type { CardLevelFields } from '~/utils/card-level'
import type { CardValueKind } from '~/utils/card-values'

export interface InventoryExportWords {
  /** The name in the card language. */
  cardName: (card: CardNameFields) => string
  /** The English name when it differs from the one `cardName` gives. */
  englishName: (card: CardNameFields) => string | null
  /** A card type, attribute or monster type in the card language. */
  cardValue: (kind: CardValueKind, value: string) => string
  /** "Stufe 7" / "Rang 4" / "Link 3", or null when the card has none. */
  levelLabel: (card: CardLevelFields) => string | null
  /** The group's name for the copies without a collection. */
  noCollection: string
  /** The heading above a group: its name and how many cards it holds. */
  heading: (name: string, copies: number) => string
}

/** A passcode as printed on the card: eight digits. */
export function passcodeText(id: number): string {
  return String(id).padStart(8, '0')
}

function stat(value: number | null): ExportStat {
  // A stat printed "?" is stored as -1.
  if (value === null) {
    return null
  }
  return value < 0 ? '?' : value
}

function exportCard(row: InventoryExportRow, words: InventoryExportWords): InventoryExportCard {
  const names = { name: row.name, nameDe: row.nameDe }
  return {
    quantity: row.quantity,
    name: words.cardName(names),
    englishName: words.englishName(names),
    passcode: passcodeText(row.catalogCardId),
    type: words.cardValue('type', row.type),
    attribute: row.attribute ? words.cardValue('attribute', row.attribute) : '',
    race: row.race ? words.cardValue('race', row.race) : '',
    level: words.levelLabel({ type: row.type, level: row.level, linkval: row.linkval }) ?? '',
    atk: stat(row.atk),
    def: stat(row.def),
    note: row.note?.trim() ?? '',
  }
}

/**
 * The rows, which the server sorts by collection and name, as one group per collection. Rows of one collection follow each other,
 * so a group ends where the collection changes; the copies without one are the last group.
 */
export function inventoryExportGroups(rows: readonly InventoryExportRow[], words: InventoryExportWords): InventoryExportGroup[] {
  const groups: InventoryExportGroup[] = []
  const copies: number[] = []
  let currentId: string | null | undefined
  for (const row of rows) {
    if (groups.length === 0 || row.collectionId !== currentId) {
      groups.push({ title: row.collectionName ?? words.noCollection, heading: '', cards: [] })
      copies.push(0)
      currentId = row.collectionId
    }
    groups.at(-1)!.cards.push(exportCard(row, words))
    copies[copies.length - 1]! += row.quantity
  }
  groups.forEach((group, index) => {
    group.heading = words.heading(group.title, copies[index]!)
  })
  return groups
}

/** How many copies the rows hold, and how many different cards. */
export function inventoryExportTotals(rows: readonly InventoryExportRow[]): { copies: number, kinds: number } {
  return {
    copies: rows.reduce((sum, row) => sum + row.quantity, 0),
    kinds: new Set(rows.map(row => row.catalogCardId)).size,
  }
}
