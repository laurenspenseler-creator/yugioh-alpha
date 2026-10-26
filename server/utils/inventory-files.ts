import { and, desc, eq, sql } from 'drizzle-orm'
import { createError } from 'h3'
import { randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { resolveDataDir } from '../db'
import type { useDb } from '../db'
import { inventoryFile } from '../db/schema'
import {
  INVENTORY_FILE_MAX_BYTES,
  INVENTORY_FILE_MAX_COUNT,
  INVENTORY_FILE_MAX_PER_UPLOAD,
  INVENTORY_FILE_MAX_TOTAL_BYTES,
  INVENTORY_FILE_NAME_MAX_LENGTH,
} from '../../shared/inventory-files'
import type { InventoryFilesResponse, InventoryFileView } from '../../shared/inventory-files'

type Db = ReturnType<typeof useDb>

// Inventory files (ADR 0033). The bytes sit under `<db dir>/files/<user id>/<file id>`,
// named by id only: the user's file name never becomes a path, so a name like
// `../../x` can't reach anything. The browser only ever opens a file inline
// when its extension is on this list; everything else (spreadsheets, SVG, HTML,
// scripts, archives …) is sent as a download, so an uploaded file can't run in
// the app's origin.
const INLINE_TYPES: Readonly<Record<string, string>> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  txt: 'text/plain; charset=utf-8',
}

const DOWNLOAD_TYPES: Readonly<Record<string, string>> = {
  csv: 'text/csv; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  json: 'application/json',
}

const FALLBACK_CONTENT_TYPE = 'application/octet-stream'
const SAFE_ID = /^[\w-]+$/

function fileError(statusCode: number, message: string, code: string, params?: Record<string, unknown>): never {
  throw createError({ statusCode, statusMessage: message, data: { code, ...(params ? { params } : {}) } })
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase()
}

export function contentTypeForName(name: string): string {
  const extension = extensionOf(name)
  return INLINE_TYPES[extension] ?? DOWNLOAD_TYPES[extension] ?? FALLBACK_CONTENT_TYPE
}

export function isOpenableName(name: string): boolean {
  return extensionOf(name) in INLINE_TYPES
}

/** The name a browser sent, cut down to a plain file name: no folders, no control characters, bounded. */
export function sanitizeFileName(raw: string | undefined): string {
  const base = (raw ?? '').split(/[\\/]/).pop() ?? ''
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001F\u007F]/g, '').replace(/\s+/g, ' ').trim()
  if (cleaned === '' || cleaned === '.' || cleaned === '..') {
    return 'datei'
  }
  if (cleaned.length <= INVENTORY_FILE_NAME_MAX_LENGTH) {
    return cleaned
  }
  const extension = extensionOf(cleaned)
  const keep = extension !== '' && extension.length <= 10 ? `.${extension}` : ''
  return cleaned.slice(0, INVENTORY_FILE_NAME_MAX_LENGTH - keep.length) + keep
}

/** Where the file bytes live: beside the database file (ADR 0033). Tests pass a temp folder instead. */
export function defaultFilesDir(): string {
  return join(resolveDataDir(), 'files')
}

function filePath(dir: string, userId: string, fileId: string): string {
  if (!SAFE_ID.test(userId) || !SAFE_ID.test(fileId)) {
    fileError(404, 'File not found', 'inventory_file_not_found')
  }
  return join(dir, userId, fileId)
}

function toView(row: typeof inventoryFile.$inferSelect): InventoryFileView {
  return {
    id: row.id,
    name: row.name,
    size: row.size,
    openable: isOpenableName(row.name),
    createdAt: row.createdAt.toISOString(),
  }
}

export function listInventoryFiles(db: Db, userId: string): InventoryFilesResponse {
  const rows = db
    .select()
    .from(inventoryFile)
    .where(eq(inventoryFile.userId, userId))
    .orderBy(desc(inventoryFile.createdAt), desc(inventoryFile.id))
    .all()

  return {
    items: rows.map(toView),
    totalBytes: rows.reduce((sum, row) => sum + row.size, 0),
  }
}

export interface IncomingFile {
  filename?: string
  data: Buffer
}

/**
 * Stores the files of one upload. Every file is checked first and nothing is
 * written when one of them is refused (empty, too big, over a quota).
 */
export async function saveInventoryFiles(db: Db, userId: string, incoming: IncomingFile[], dir = defaultFilesDir()): Promise<InventoryFileView[]> {
  if (incoming.length === 0) {
    fileError(400, 'No file in the request', 'inventory_file_required')
  }
  if (incoming.length > INVENTORY_FILE_MAX_PER_UPLOAD) {
    fileError(400, 'Too many files in one upload', 'inventory_upload_too_many', { max: INVENTORY_FILE_MAX_PER_UPLOAD })
  }

  let addedBytes = 0
  for (const file of incoming) {
    if (file.data.length === 0) {
      fileError(400, 'The file is empty', 'inventory_file_empty')
    }
    if (file.data.length > INVENTORY_FILE_MAX_BYTES) {
      fileError(413, 'The file is too large', 'inventory_file_too_large', { max: INVENTORY_FILE_MAX_BYTES / (1024 * 1024) })
    }
    addedBytes += file.data.length
  }

  const usage = db
    .select({ count: sql<number>`count(*)`, bytes: sql<number>`coalesce(sum(${inventoryFile.size}), 0)` })
    .from(inventoryFile)
    .where(eq(inventoryFile.userId, userId))
    .get()
  if ((usage?.count ?? 0) + incoming.length > INVENTORY_FILE_MAX_COUNT) {
    fileError(409, 'Too many files', 'inventory_file_limit', { max: INVENTORY_FILE_MAX_COUNT })
  }
  if ((usage?.bytes ?? 0) + addedBytes > INVENTORY_FILE_MAX_TOTAL_BYTES) {
    fileError(413, 'The storage quota is used up', 'inventory_storage_full', { max: INVENTORY_FILE_MAX_TOTAL_BYTES / (1024 * 1024) })
  }

  const created: InventoryFileView[] = []
  const written: string[] = []
  try {
    for (const file of incoming) {
      const id = randomUUID()
      const name = sanitizeFileName(file.filename)
      const path = filePath(dir, userId, id)
      await mkdir(join(path, '..'), { recursive: true })
      await writeFile(path, file.data, { flag: 'wx' })
      written.push(path)

      const row = db
        .insert(inventoryFile)
        .values({ id, userId, name, contentType: contentTypeForName(name), size: file.data.length, createdAt: new Date() })
        .returning()
        .get()
      created.push(toView(row))
    }
  }
  catch (error) {
    await Promise.all(written.map(path => unlink(path).catch(() => {})))
    for (const view of created) {
      db.delete(inventoryFile).where(eq(inventoryFile.id, view.id)).run()
    }
    throw error
  }

  return created
}

export interface InventoryFileDownload {
  name: string
  size: number
  contentType: string
  openable: boolean
  stream: ReturnType<typeof createReadStream>
}

export function openInventoryFile(db: Db, userId: string, fileId: string, dir = defaultFilesDir()): InventoryFileDownload {
  const row = db
    .select()
    .from(inventoryFile)
    .where(and(eq(inventoryFile.id, fileId), eq(inventoryFile.userId, userId)))
    .get()
  if (!row) {
    fileError(404, 'File not found', 'inventory_file_not_found')
  }

  const openable = isOpenableName(row.name)
  return {
    name: row.name,
    size: row.size,
    contentType: openable ? row.contentType : FALLBACK_CONTENT_TYPE,
    openable,
    stream: createReadStream(filePath(dir, userId, row.id)),
  }
}

export async function deleteInventoryFile(db: Db, userId: string, fileId: string, dir = defaultFilesDir()): Promise<void> {
  const row = db
    .select({ id: inventoryFile.id })
    .from(inventoryFile)
    .where(and(eq(inventoryFile.id, fileId), eq(inventoryFile.userId, userId)))
    .get()
  if (!row) {
    fileError(404, 'File not found', 'inventory_file_not_found')
  }

  db.delete(inventoryFile).where(eq(inventoryFile.id, row.id)).run()
  await unlink(filePath(dir, userId, row.id)).catch(() => {})
}

/**
 * `Content-Disposition` for a download or an inline view: an ASCII fallback
 * name plus the real one as RFC 5987 `filename*`, so umlauts and spaces survive.
 */
export function contentDisposition(kind: 'inline' | 'attachment', name: string): string {
  const fallback = name.replace(/[^\x20-\x7E]/g, '_').replace(/["\\%;]/g, '_')
  const encoded = encodeURIComponent(name).replace(/['()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
  return `${kind}; filename="${fallback}"; filename*=UTF-8''${encoded}`
}
