// Reads a card list out of a spreadsheet or text file in the browser and turns
// it into quick-capture lines ("3x Dark Magician (SDY-006)"). The server never
// sees the file: it gets the lines, like a pasted list, and matches them against
// the catalog (server/utils/card-entry.ts). Supported: .xlsx / .xlsm, .csv /
// .tsv, and plain text lists (.txt, .ydk). Old .xls and .ods are not.
import { strFromU8, unzipSync } from 'fflate'

export type Cell = string | number | boolean | null
export type SheetRows = Cell[][]

export type SpreadsheetErrorCode = 'unsupported' | 'unreadable' | 'tooLarge' | 'noCards'

export class SpreadsheetError extends Error {
  constructor(readonly code: SpreadsheetErrorCode) {
    super(code)
  }
}

export const SPREADSHEET_MAX_BYTES = 5 * 1024 * 1024
export const SPREADSHEET_MAX_LINES = 5000
// An XLSX is a zip of XML; a part this big (uncompressed) is not a card list.
const XLSX_MAX_PART_BYTES = 50 * 1024 * 1024
const XLSX_MAX_ROWS = 20000
const XLSX_PARTS = /^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/[^/]+\.xml)$/

// --- CSV --------------------------------------------------------------------

const DELIMITERS = [';', '\t', ','] as const

function splitCsv(text: string, delimiter: string | null): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false

  function endField() {
    row.push(field)
    field = ''
  }
  function endRow() {
    endField()
    rows.push(row)
    row = []
  }

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"'
        index += 1
      }
      else if (char === '"') {
        quoted = false
      }
      else {
        field += char
      }
    }
    else if (char === '"' && field === '') {
      quoted = true
    }
    else if (delimiter !== null && char === delimiter) {
      endField()
    }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') {
        index += 1
      }
      endRow()
    }
    else {
      field += char
    }
  }
  if (field !== '' || row.length > 0) {
    endRow()
  }
  return rows
}

/**
 * The delimiter every line agrees on, or `null` for a one-column list. A comma
 * inside some card names ("Brecher, Magischer Krieger") must not turn a plain
 * list into a table: a real CSV has the same number of fields in (nearly)
 * every line.
 */
function detectDelimiter(text: string): string | null {
  const sample = text.split(/\r?\n/).filter(line => line.trim() !== '').slice(0, 30)
  for (const delimiter of DELIMITERS) {
    const counts = sample.map(line => splitCsv(line, delimiter)[0]?.length ?? 1)
    const expected = counts[0] ?? 1
    if (expected > 1 && counts.filter(count => count === expected).length >= Math.ceil(counts.length * 0.8)) {
      return delimiter
    }
  }
  return null
}

export function parseCsv(input: string): SheetRows {
  const text = input.replace(/^\uFEFF/, '')
  return splitCsv(text, detectDelimiter(text))
}

// --- XLSX -------------------------------------------------------------------

function parseXml(xml: string): Document {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new SpreadsheetError('unreadable')
  }
  return doc
}

// Elements and attributes are matched by local name, ignoring case and any
// namespace prefix: some writers use `x:row` or `r:id`, and not every DOM keeps
// the case of XML names.
const sameName = (actual: string, wanted: string) => actual.toLowerCase().replace(/^.*:/, '') === wanted.toLowerCase()

const byTag = (root: Document | Element, name: string): Element[] =>
  Array.from(root.getElementsByTagName('*')).filter(element => sameName(element.localName || element.nodeName, name))

const children = (element: Element, name: string): Element[] =>
  Array.from(element.children).filter(child => sameName(child.localName || child.nodeName, name))

function attr(element: Element, name: string): string | null {
  return Array.from(element.attributes).find(attribute => sameName(attribute.name, name))?.value ?? null
}

function childText(element: Element, name: string): string | null {
  return children(element, name)[0]?.textContent ?? null
}

function columnIndex(reference: string): number {
  let index = 0
  for (const char of reference.replace(/[^A-Za-z]/g, '').toUpperCase()) {
    index = index * 26 + (char.charCodeAt(0) - 64)
  }
  return Math.max(0, index - 1)
}

export interface Sheet {
  name: string
  rows: SheetRows
}

/** The visible sheets of the workbook in order, with the part each one is stored in. */
function visibleSheetPaths(files: Record<string, Uint8Array>): { name: string, path: string }[] {
  const workbook = parseXml(strFromU8(files['xl/workbook.xml']!))
  const rels = files['xl/_rels/workbook.xml.rels']
  const relationships = rels ? byTag(parseXml(strFromU8(rels)), 'Relationship') : []

  const sheets: { name: string, path: string }[] = []
  for (const sheet of byTag(workbook, 'sheet')) {
    if (['hidden', 'veryhidden'].includes((attr(sheet, 'state') ?? '').toLowerCase())) {
      continue
    }
    const relationshipId = attr(sheet, 'id')
    const relationship = relationships.find(rel => attr(rel, 'Id') === relationshipId)
    const target = relationship ? attr(relationship, 'Target') : null
    const path = target ? (target.startsWith('/') ? target.slice(1) : `xl/${target}`) : null
    if (path && files[path]) {
      sheets.push({ name: attr(sheet, 'name') ?? path, path })
    }
  }
  if (sheets.length > 0) {
    return sheets
  }
  return Object.keys(files).filter(name => name.startsWith('xl/worksheets/')).sort().slice(0, 1).map(path => ({ name: path, path }))
}

/** Every visible sheet of an .xlsx, in order. */
export function readXlsxSheets(bytes: Uint8Array): Sheet[] {
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(bytes, { filter: file => file.originalSize <= XLSX_MAX_PART_BYTES && XLSX_PARTS.test(file.name) })
  }
  catch {
    throw new SpreadsheetError('unreadable')
  }
  if (!files['xl/workbook.xml']) {
    throw new SpreadsheetError('unreadable')
  }
  const sheetPaths = visibleSheetPaths(files)
  if (sheetPaths.length === 0) {
    throw new SpreadsheetError('unreadable')
  }

  const sharedXml = files['xl/sharedStrings.xml']
  const shared = sharedXml
    ? byTag(parseXml(strFromU8(sharedXml)), 'si').map(item => byTag(item, 't')
        .filter(text => !text.parentElement || !sameName(text.parentElement.localName || text.parentElement.nodeName, 'rPh'))
        .map(text => text.textContent ?? '')
        .join(''))
    : []

  return sheetPaths.map(({ name, path }) => ({ name, rows: readSheetRows(strFromU8(files[path]!), shared) }))
}

/** The first visible sheet of an .xlsx. */
export function readXlsx(bytes: Uint8Array): SheetRows {
  return readXlsxSheets(bytes)[0]!.rows
}

function readSheetRows(xml: string, shared: string[]): SheetRows {
  const rows: SheetRows = []
  for (const row of byTag(parseXml(xml), 'row').slice(0, XLSX_MAX_ROWS)) {
    const cells: Cell[] = []
    for (const cell of children(row, 'c')) {
      const reference = attr(cell, 'r')
      const column = reference ? columnIndex(reference) : cells.length
      const type = attr(cell, 't')
      const raw = childText(cell, 'v')

      let value: Cell = null
      if (type === 'inlineStr') {
        value = byTag(cell, 't').map(text => text.textContent ?? '').join('')
      }
      else if (raw !== null) {
        if (type === 's') {
          value = shared[Number(raw)] ?? null
        }
        else if (type === 'b') {
          value = raw === '1'
        }
        else if (type === 'str' || type === 'e') {
          value = raw
        }
        else {
          const number = Number(raw)
          value = Number.isFinite(number) ? number : raw
        }
      }

      while (cells.length < column) {
        cells.push(null)
      }
      cells[column] = value
    }
    rows.push(cells)
  }
  return rows
}

// --- Columns to lines -------------------------------------------------------

const SET_CODE = /^[A-Z0-9]{2,5}-[A-Z]{0,3}\d{3}$/i
// "Karten" / "Cards" are left out on purpose: as a header they usually mean how many cards.
const NAME_HEADER = /^(?:kartenname|cardname|name|nameen|namede|namedeutsch|nameenglisch|englischername|deutschername|englishname|germanname|karte|card|titel|title|bezeichnung|kartenbezeichnung)$/
// The long words also match as a prefix: "Anzahl in aktueller Planung", "Menge (Stück)".
const QUANTITY_HEADER = /^(?:(?:menge|anzahl|stuck|stk|qty|quantity|exemplare|kopien|copies|bestand)\w*|anz|count|amount|x|#)$/
const SET_HEADER = /^(?:setcode|code|setnummer|setnr|kartennummer|nummer|cardnumber|number|nr|seriennummer)$/

function headerKey(cell: Cell): string {
  return cell === null ? '' : String(cell).toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '').replace(/[^a-z0-9#]/g, '')
}

function cellText(cell: Cell | undefined): string {
  if (cell === null || cell === undefined || typeof cell === 'boolean') {
    return ''
  }
  return String(cell).replace(/\s+/g, ' ').trim()
}

function cellQuantity(cell: Cell | undefined): number | null {
  if (typeof cell === 'number') {
    return Number.isInteger(cell) && cell >= 0 && cell <= 999 ? cell : null
  }
  const match = typeof cell === 'string' ? /^\s*(\d{1,3})\s*[x×]?\s*$/i.exec(cell) : null
  return match ? Number(match[1]) : null
}

interface Columns {
  name: number
  quantity: number | null
  setCode: number | null
  firstDataRow: number
}

function headerColumns(rows: SheetRows): Columns | null {
  for (let index = 0; index < Math.min(rows.length, 5); index += 1) {
    const keys = rows[index]!.map(headerKey)
    const name = keys.findIndex(key => NAME_HEADER.test(key))
    if (name >= 0) {
      const quantity = keys.findIndex((key, column) => column !== name && QUANTITY_HEADER.test(key))
      const setCode = keys.findIndex((key, column) => column !== name && column !== quantity && SET_HEADER.test(key))
      return { name, quantity: quantity >= 0 ? quantity : null, setCode: setCode >= 0 ? setCode : null, firstDataRow: index + 1 }
    }
  }
  return null
}

/** Without a header row: a column of small whole numbers is the quantity, the most text-like other column the name. */
function guessColumns(rows: SheetRows): Columns {
  const width = Math.max(...rows.map(row => row.length))
  const values = (column: number) => rows.map(row => cellText(row[column])).filter(text => text !== '')
  const isCount = (text: string) => /^\d{1,2}\s*[x×]?$/i.test(text) && Number.parseInt(text, 10) >= 1

  const columns = Array.from({ length: width }, (_, column) => column)
  const quantity = width > 1
    ? columns.find(column => values(column).length > 0 && values(column).every(isCount)) ?? null
    : null
  const textScore = (column: number) => values(column).filter(text => !/^[\d\s.,x×-]+$/i.test(text)).length
  const name = columns.filter(column => column !== quantity).sort((a, b) => textScore(b) - textScore(a))[0] ?? 0
  const setCode = columns.find((column) => {
    const texts = values(column)
    return column !== name && column !== quantity && texts.length > 0 && texts.filter(text => SET_CODE.test(text)).length >= texts.length / 2
  }) ?? null

  return { name, quantity, setCode, firstDataRow: 0 }
}

export interface EntryLines {
  lines: string[]
  /** Rows that named no card or had a zero / empty quantity. */
  skipped: number
  /** Whether the sheet had a header row naming the card column (the best sign it is a card list). */
  header: boolean
}

// A bare number of up to four digits is a count or a row number, never a card;
// a passcode has five to ten digits.
const NOT_A_CARD = /^\d{1,4}$/

/** Quick-capture lines for the rows of a sheet: "3x Name" or "3x Name (SET-001)". */
export function rowsToEntryLines(input: SheetRows): EntryLines {
  const rows = input.filter(row => row.some(cell => cellText(cell) !== ''))
  if (rows.length === 0) {
    return { lines: [], skipped: 0, header: false }
  }

  // One column: the lines are written the way quick capture reads them already.
  if (Math.max(...rows.map(row => row.length)) === 1) {
    const lines = rows.map(row => cellText(row[0])).filter(text => text !== '')
    const header = NAME_HEADER.test(headerKey(lines[0] ?? ''))
    return { lines: header ? lines.slice(1) : lines, skipped: 0, header }
  }

  const headerRow = headerColumns(rows)
  const columns = headerRow ?? guessColumns(rows)
  const lines: string[] = []
  let skipped = 0

  for (const row of rows.slice(columns.firstDataRow)) {
    const name = cellText(row[columns.name])
    const quantity = columns.quantity === null ? 1 : cellQuantity(row[columns.quantity])
    if (name === '' || NOT_A_CARD.test(name) || quantity === null || quantity < 1) {
      skipped += 1
      continue
    }
    const setCode = columns.setCode === null ? '' : cellText(row[columns.setCode])
    lines.push(`${quantity}x ${name}${SET_CODE.test(setCode) ? ` (${setCode.toUpperCase()})` : ''}`)
  }

  return { lines, skipped, header: headerRow !== null }
}

// --- Files ------------------------------------------------------------------

const SHEET_EXTENSIONS = new Set(['xlsx', 'xlsm'])
const TEXT_EXTENSIONS = new Set(['csv', 'tsv', 'txt', 'ydk', 'lst'])

export function isImportableFileName(name: string): boolean {
  const extension = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : ''
  return SHEET_EXTENSIONS.has(extension) || TEXT_EXTENSIONS.has(extension)
}

/** The cards one sheet (or a whole CSV / text file) would bring in. */
export interface SheetCandidate extends EntryLines {
  /** The sheet's name; `null` for a text or CSV file. */
  sheetName: string | null
  /** The list had more lines than `SPREADSHEET_MAX_LINES`; the rest was left out. */
  truncated: boolean
}

function toCandidate(result: EntryLines, sheetName: string | null): SheetCandidate {
  return {
    ...result,
    lines: result.lines.slice(0, SPREADSHEET_MAX_LINES),
    sheetName,
    truncated: result.lines.length > SPREADSHEET_MAX_LINES,
  }
}

/**
 * The sheets of a workbook that hold cards, in workbook order. A sheet with a
 * card-name header ("Name", "Karte") is a card list; sheets without one only
 * count when no sheet has one, so a "Dashboard" of numbers isn't offered.
 */
export function cardCandidates(sheets: Sheet[]): SheetCandidate[] {
  const withCards = sheets
    .map(sheet => ({ result: rowsToEntryLines(sheet.rows), sheetName: sheet.name }))
    .filter(({ result }) => result.lines.length > 0)
  const withHeader = withCards.filter(({ result }) => result.header)
  return (withHeader.length > 0 ? withHeader : withCards).map(({ result, sheetName }) => toCandidate(result, sheetName))
}

/**
 * Reads a file and returns where cards were found: one candidate for a text or
 * CSV file, one per card sheet of a workbook (the page lets the user pick when
 * there are several). Throws a `SpreadsheetError` the page translates.
 */
export async function readCardCandidates(file: Blob, fileName: string): Promise<SheetCandidate[]> {
  if (!isImportableFileName(fileName)) {
    throw new SpreadsheetError('unsupported')
  }
  if (file.size > SPREADSHEET_MAX_BYTES) {
    throw new SpreadsheetError('tooLarge')
  }

  const extension = fileName.slice(fileName.lastIndexOf('.') + 1).toLowerCase()
  let candidates: SheetCandidate[]
  if (SHEET_EXTENSIONS.has(extension)) {
    candidates = cardCandidates(readXlsxSheets(new Uint8Array(await file.arrayBuffer())))
  }
  else {
    const result = rowsToEntryLines(parseCsv(await file.text()))
    candidates = result.lines.length > 0 ? [toCandidate(result, null)] : []
  }
  if (candidates.length === 0) {
    throw new SpreadsheetError('noCards')
  }
  return candidates
}
