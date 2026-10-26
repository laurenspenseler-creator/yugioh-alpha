import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { eq } from 'drizzle-orm'
import Database from 'better-sqlite3'
import { access, mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { text } from 'node:stream/consumers'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as schema from '../../server/db/schema'
import {
  contentDisposition,
  contentTypeForName,
  deleteInventoryFile,
  isOpenableName,
  listInventoryFiles,
  openInventoryFile,
  sanitizeFileName,
  saveInventoryFiles,
} from '../../server/utils/inventory-files'
import {
  INVENTORY_FILE_MAX_BYTES,
  INVENTORY_FILE_MAX_COUNT,
  INVENTORY_FILE_MAX_PER_UPLOAD,
} from '../../shared/inventory-files'
import { fileIcon, formatBytes } from '../../app/utils/inventory-files'

function createTestDb() {
  const sqlite = new Database(':memory:')
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: './server/db/migrations' })
  return db
}

function seedUsers(db: ReturnType<typeof createTestDb>) {
  const now = new Date()
  db.insert(schema.user).values(['user-a', 'user-b'].map(id => ({
    id,
    name: id,
    email: `${id}@example.com`,
    emailVerified: false,
    createdAt: now,
    updatedAt: now,
  }))).run()
}

const file = (filename: string, content: string) => ({ filename, data: Buffer.from(content) })

describe('inventory file names and types', () => {
  it('cuts a browser-sent name down to a plain file name', () => {
    expect(sanitizeFileName('Sammlung Übersicht.xlsx')).toBe('Sammlung Übersicht.xlsx')
    expect(sanitizeFileName('../../etc/passwd.txt')).toBe('passwd.txt')
    expect(sanitizeFileName('C:\\Users\\me\\scan.pdf')).toBe('scan.pdf')
    expect(sanitizeFileName('  a\u0000b\tc  d.txt ')).toBe('abc d.txt')
    expect(sanitizeFileName('')).toBe('datei')
    expect(sanitizeFileName(undefined)).toBe('datei')
    expect(sanitizeFileName('..')).toBe('datei')
  })

  it('keeps the extension when a long name is cut', () => {
    const name = sanitizeFileName(`${'a'.repeat(300)}.xlsx`)

    expect(name).toHaveLength(200)
    expect(name.endsWith('.xlsx')).toBe(true)
  })

  it('opens only PDF, images and plain text inline; everything else is a download', () => {
    for (const name of ['a.pdf', 'a.PNG', 'a.jpg', 'a.jpeg', 'a.gif', 'a.webp', 'a.txt']) {
      expect(isOpenableName(name)).toBe(true)
    }
    for (const name of ['a.xlsx', 'a.csv', 'a.html', 'a.svg', 'a.js', 'a.exe', 'a']) {
      expect(isOpenableName(name)).toBe(false)
    }
    expect(contentTypeForName('Tabelle.XLSX')).toContain('spreadsheetml')
    expect(contentTypeForName('x.unknown')).toBe('application/octet-stream')
  })

  it('writes a Content-Disposition that survives umlauts, quotes and spaces', () => {
    expect(contentDisposition('attachment', 'Sammlung Übersicht.xlsx')).toBe(
      'attachment; filename="Sammlung _bersicht.xlsx"; filename*=UTF-8\'\'Sammlung%20%C3%9Cbersicht.xlsx',
    )
    expect(contentDisposition('inline', 'a"b.pdf')).toContain('filename="a_b.pdf"')
  })

  it('formats sizes and picks icons for the page', () => {
    expect(formatBytes(0, 'en')).toBe('0 byte')
    expect(formatBytes(1536, 'en')).toContain('1.5')
    expect(formatBytes(25 * 1024 * 1024, 'en')).toContain('25')
    expect(fileIcon('a.XLSX')).toBe('i-lucide-file-spreadsheet')
    expect(fileIcon('a.png')).toBe('i-lucide-file-image')
    expect(fileIcon('a.pdf')).toBe('i-lucide-file-text')
    expect(fileIcon('a.bin')).toBe('i-lucide-file')
  })
})

describe('inventory file storage', () => {
  let db: ReturnType<typeof createTestDb>
  let dir: string

  beforeEach(async () => {
    db = createTestDb()
    seedUsers(db)
    dir = await mkdtemp(join(tmpdir(), 'ygo-files-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('stores a file by id, lists it, opens it again and deletes it', async () => {
    const [created] = await saveInventoryFiles(db, 'user-a', [file('Sammlung Übersicht.xlsx', 'PK-xlsx')], dir)

    expect(created).toMatchObject({ name: 'Sammlung Übersicht.xlsx', size: 7, openable: false })
    // Named by id: the user's file name is never part of the path.
    expect(await readdir(join(dir, 'user-a'))).toEqual([created!.id])

    const listed = listInventoryFiles(db, 'user-a')
    expect(listed.items.map(item => item.id)).toEqual([created!.id])
    expect(listed.totalBytes).toBe(7)

    const download = openInventoryFile(db, 'user-a', created!.id, dir)
    expect(download).toMatchObject({ name: 'Sammlung Übersicht.xlsx', openable: false, contentType: 'application/octet-stream' })
    expect(await text(download.stream)).toBe('PK-xlsx')

    await deleteInventoryFile(db, 'user-a', created!.id, dir)
    expect(listInventoryFiles(db, 'user-a').items).toEqual([])
    await expect(access(join(dir, 'user-a', created!.id))).rejects.toThrow()
  })

  it('reports a PDF as openable with its own content type', async () => {
    const [created] = await saveInventoryFiles(db, 'user-a', [file('scan.pdf', '%PDF-1.4')], dir)

    expect(created!.openable).toBe(true)
    expect(openInventoryFile(db, 'user-a', created!.id, dir).contentType).toBe('application/pdf')
  })

  it('never serves an uploaded HTML or SVG file as a page', async () => {
    const [html, svg] = await saveInventoryFiles(db, 'user-a', [file('x.html', '<script>1</script>'), file('x.svg', '<svg/>')], dir)

    for (const created of [html, svg]) {
      expect(openInventoryFile(db, 'user-a', created!.id, dir)).toMatchObject({ openable: false, contentType: 'application/octet-stream' })
    }
  })

  it('keeps a file private to its owner', async () => {
    const [created] = await saveInventoryFiles(db, 'user-a', [file('geheim.txt', 'x')], dir)

    expect(listInventoryFiles(db, 'user-b').items).toEqual([])
    expect(() => openInventoryFile(db, 'user-b', created!.id, dir)).toThrowError(expect.objectContaining({ statusCode: 404 }))
    await expect(deleteInventoryFile(db, 'user-b', created!.id, dir)).rejects.toMatchObject({ statusCode: 404 })
    expect(listInventoryFiles(db, 'user-a').items).toHaveLength(1)
  })

  it('answers an unknown or path-like id with 404', async () => {
    expect(() => openInventoryFile(db, 'user-a', 'nope', dir)).toThrowError(expect.objectContaining({ statusCode: 404 }))
    expect(() => openInventoryFile(db, 'user-a', '../../app.db', dir)).toThrowError(expect.objectContaining({ statusCode: 404 }))
  })

  it('refuses an empty upload, a file without content and an oversized file', async () => {
    await expect(saveInventoryFiles(db, 'user-a', [], dir)).rejects.toMatchObject({ statusCode: 400, data: { code: 'inventory_file_required' } })
    await expect(saveInventoryFiles(db, 'user-a', [file('leer.txt', '')], dir)).rejects.toMatchObject({ statusCode: 400, data: { code: 'inventory_file_empty' } })
    await expect(saveInventoryFiles(db, 'user-a', [{ filename: 'big.bin', data: Buffer.alloc(INVENTORY_FILE_MAX_BYTES + 1) }], dir))
      .rejects.toMatchObject({ statusCode: 413, data: { code: 'inventory_file_too_large', params: { max: 25 } } })
  })

  it('writes nothing when one file of the upload is refused', async () => {
    await expect(saveInventoryFiles(db, 'user-a', [file('ok.txt', 'x'), file('leer.txt', '')], dir)).rejects.toThrow()

    expect(listInventoryFiles(db, 'user-a').items).toEqual([])
    await expect(readdir(join(dir, 'user-a'))).rejects.toThrow()
  })

  it('limits the files per upload and per user', async () => {
    const tooMany = Array.from({ length: INVENTORY_FILE_MAX_PER_UPLOAD + 1 }, (_, index) => file(`f${index}.txt`, 'x'))
    await expect(saveInventoryFiles(db, 'user-a', tooMany, dir)).rejects.toMatchObject({ data: { code: 'inventory_upload_too_many' } })

    const now = new Date()
    db.insert(schema.inventoryFile).values(Array.from({ length: INVENTORY_FILE_MAX_COUNT }, (_, index) => ({
      id: `existing-${index}`,
      userId: 'user-a',
      name: `old-${index}.txt`,
      contentType: 'text/plain',
      size: 1,
      createdAt: now,
    }))).run()
    await expect(saveInventoryFiles(db, 'user-a', [file('one-more.txt', 'x')], dir)).rejects.toMatchObject({ statusCode: 409, data: { code: 'inventory_file_limit' } })
    // Another user's quota is separate.
    await expect(saveInventoryFiles(db, 'user-b', [file('mine.txt', 'x')], dir)).resolves.toHaveLength(1)
  })

  it('removes a user\'s file rows with the user', async () => {
    await saveInventoryFiles(db, 'user-a', [file('a.txt', 'x')], dir)

    db.delete(schema.user).where(eq(schema.user.id, 'user-a')).run()

    expect(db.select().from(schema.inventoryFile).all()).toEqual([])
  })
})
