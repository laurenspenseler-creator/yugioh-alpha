// Inventory files (ADR 0033): the limits and the listing shape shared by the
// server (server/utils/inventory-files.ts) and the inventory files page.
// Dependency-free: no Drizzle, no h3, no Vue.

/** The largest single file, in bytes. */
export const INVENTORY_FILE_MAX_BYTES = 25 * 1024 * 1024
/** The most files one user keeps. */
export const INVENTORY_FILE_MAX_COUNT = 200
/** The most bytes all of one user's files may take together. */
export const INVENTORY_FILE_MAX_TOTAL_BYTES = 500 * 1024 * 1024
/** The most files one upload request may carry. */
export const INVENTORY_FILE_MAX_PER_UPLOAD = 20
export const INVENTORY_FILE_NAME_MAX_LENGTH = 200

export interface InventoryFileView {
  id: string
  name: string
  size: number
  /** Whether the browser can show the file itself (PDF, image, text); every other file is downloaded. */
  openable: boolean
  createdAt: string
}

export interface InventoryFilesResponse {
  items: InventoryFileView[]
  /** Bytes of all the user's files, for the usage line. */
  totalBytes: number
}
