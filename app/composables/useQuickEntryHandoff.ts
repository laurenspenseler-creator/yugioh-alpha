/**
 * Card lines read from a file on the inventory files page, waiting for quick
 * capture to pick them up (`/inventory/quick-entry` takes them on mount and
 * clears this). A `useState` key, so it survives the client-side navigation
 * between the two pages and is empty on a fresh load.
 */
import type { SheetCandidate } from '~/utils/spreadsheet-list'

export interface QuickEntryHandoff {
  name: string
  candidates: SheetCandidate[]
}

export function useQuickEntryHandoff() {
  return useState<QuickEntryHandoff | null>('quick-entry-handoff', () => null)
}
