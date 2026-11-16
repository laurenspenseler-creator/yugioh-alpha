// The inventory as a file (ADR 0051): an Excel table (.xlsx), a Word document (.docx) or a plain text list (.txt).
// Pure functions from a prepared document to bytes or text, shared by the browser (app/components/inventory/InventoryExportMenu.vue)
// and the tests. An .xlsx and a .docx are zips of XML parts, written by hand with fflate (already a dependency for reading
// spreadsheets), so exporting adds no library. No Drizzle, no h3, no Vue.
import { strToU8, zipSync } from 'fflate'

export const INVENTORY_EXPORT_FORMATS = ['xlsx', 'docx', 'txt'] as const
export type InventoryExportFormat = typeof INVENTORY_EXPORT_FORMATS[number]

export const INVENTORY_EXPORT_MIME: Record<InventoryExportFormat, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain;charset=utf-8',
}

/**
 * One row of `GET /api/inventory/export`: a card in a collection (or in none), in the stored English values; the browser words
 * them in the card language (app/utils/inventory-export.ts).
 */
export interface InventoryExportRow {
  catalogCardId: number
  collectionId: string | null
  collectionName: string | null
  quantity: number
  note: string | null
  name: string
  nameDe: string | null
  type: string
  attribute: string | null
  race: string | null
  level: number | null
  linkval: number | null
  /** `-1` is a stat printed "?". */
  atk: number | null
  def: number | null
}

/** ATK / DEF: a number, `'?'` for a stat printed "?", or nothing (a Spell has none). */
export type ExportStat = number | '?' | null

/** One line of the export: a card in a collection, with its words already in the language the file is written in. */
export interface InventoryExportCard {
  quantity: number
  name: string
  /** The English name when the file shows another language, else null. */
  englishName: string | null
  /** The eight digits printed on the card, as text (Excel would drop a leading zero from a number). */
  passcode: string
  type: string
  attribute: string
  race: string
  /** "Stufe 7", "Rang 4", "Link 3", or ''. */
  level: string
  atk: ExportStat
  def: ExportStat
  note: string
}

/** The copies of one collection (or the ones without a collection). */
export interface InventoryExportGroup {
  /** The collection's name, the column "Sammlung" of the Excel table. */
  title: string
  /** The heading above the group in the Word and text files: the name and how many cards it holds. */
  heading: string
  cards: InventoryExportCard[]
}

export interface InventoryExportLabels {
  /** The name of the Excel sheet. */
  sheet: string
  quantity: string
  name: string
  englishName: string
  collection: string
  type: string
  attribute: string
  race: string
  level: string
  atk: string
  def: string
  passcode: string
  note: string
}

export interface InventoryExportDocument {
  title: string
  /** The scope, the number of cards and the date. */
  subtitle: string
  /** The proofing language of the Word file, e.g. `de-DE`. */
  lang: string
  labels: InventoryExportLabels
  groups: InventoryExportGroup[]
}

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'

// Characters XML 1.0 does not allow at all (control characters, U+FFFE/U+FFFF); one in a note would make Excel and Word refuse
// the whole file.
// eslint-disable-next-line no-control-regex
const XML_FORBIDDEN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g

function xml(text: string): string {
  return text
    .replace(XML_FORBIDDEN, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function hasAny(doc: InventoryExportDocument, pick: (card: InventoryExportCard) => unknown): boolean {
  return doc.groups.some(group => group.cards.some(card => Boolean(pick(card))))
}

/** The number of copies in the document. */
export function exportCopies(doc: InventoryExportDocument): number {
  return doc.groups.reduce((sum, group) => sum + group.cards.reduce((inner, card) => inner + card.quantity, 0), 0)
}

// --- Excel -----------------------------------------------------------------

type Cell = string | number | null

interface SheetColumn {
  label: string
  /** The width in characters. */
  width: number
  value: (card: InventoryExportCard, group: InventoryExportGroup) => Cell
}

/** `0` → `A`, `25` → `Z`, `26` → `AA`. */
function columnName(index: number): string {
  let name = ''
  let rest = index + 1
  while (rest > 0) {
    const digit = (rest - 1) % 26
    name = String.fromCharCode(65 + digit) + name
    rest = Math.floor((rest - 1) / 26)
  }
  return name
}

function sheetColumns(doc: InventoryExportDocument): SheetColumn[] {
  const { labels } = doc
  const columns: Array<SheetColumn | null> = [
    { label: labels.quantity, width: 8, value: card => card.quantity },
    { label: labels.name, width: 36, value: card => card.name },
    hasAny(doc, card => card.englishName) ? { label: labels.englishName, width: 36, value: card => card.englishName } : null,
    { label: labels.collection, width: 24, value: (_card, group) => group.title },
    { label: labels.type, width: 26, value: card => card.type || null },
    { label: labels.attribute, width: 12, value: card => card.attribute || null },
    { label: labels.race, width: 16, value: card => card.race || null },
    { label: labels.level, width: 10, value: card => card.level || null },
    { label: labels.atk, width: 8, value: card => card.atk },
    { label: labels.def, width: 8, value: card => card.def },
    { label: labels.passcode, width: 11, value: card => card.passcode },
    hasAny(doc, card => card.note) ? { label: labels.note, width: 32, value: card => card.note || null } : null,
  ]
  return columns.filter((column): column is SheetColumn => column !== null)
}

function sheetCell(reference: string, value: Cell, style?: number): string {
  const s = style ? ` s="${style}"` : ''
  if (value === null || value === '') {
    return ''
  }
  if (typeof value === 'number') {
    return `<c r="${reference}"${s}><v>${value}</v></c>`
  }
  return `<c r="${reference}"${s} t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`
}

/** Excel sheet names are at most 31 characters and may not hold `\ / ? * [ ] :`. */
function sheetName(label: string): string {
  const name = label.replace(/[\\/?*[\]:]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31)
  return name || 'Sheet1'
}

const XLSX_STYLES = `${XML_HEADER}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
  + '<fonts count="2"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font>'
  + '<font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts>'
  + '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>'
  + '<fill><patternFill patternType="solid"><fgColor rgb="FFE7E6E6"/><bgColor indexed="64"/></patternFill></fill></fills>'
  + '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>'
  + '<border><left/><right/><top/><bottom style="thin"><color auto="1"/></bottom><diagonal/></border></borders>'
  + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
  + '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
  + '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/></cellXfs>'
  + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'

/** The inventory as an Excel workbook: one sheet, a header row with a filter, one row per card and collection. */
export function encodeXlsx(doc: InventoryExportDocument): Uint8Array {
  const columns = sheetColumns(doc)
  const lastColumn = columnName(columns.length - 1)
  const name = sheetName(doc.labels.sheet)
  const rows: string[] = []

  rows.push(`<row r="1">${columns.map((column, index) => sheetCell(`${columnName(index)}1`, column.label, 1)).join('')}</row>`)
  let rowNumber = 1
  for (const group of doc.groups) {
    for (const card of group.cards) {
      rowNumber += 1
      const cells = columns.map((column, index) => sheetCell(`${columnName(index)}${rowNumber}`, column.value(card, group)))
      rows.push(`<row r="${rowNumber}">${cells.join('')}</row>`)
    }
  }

  const sheet = `${XML_HEADER}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
    // Printed: all columns on the width of the page.
    + '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>'
    + `<dimension ref="A1:${lastColumn}${rowNumber}"/>`
    // The header row stays in view while scrolling.
    + '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>'
    + '<selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>'
    + '<sheetFormatPr defaultRowHeight="15"/>'
    + `<cols>${columns.map((column, index) => `<col min="${index + 1}" max="${index + 1}" width="${column.width}" customWidth="1"/>`).join('')}</cols>`
    + `<sheetData>${rows.join('')}</sheetData>`
    + `<autoFilter ref="A1:${lastColumn}${rowNumber}"/>`
    // A4 landscape, as wide as the page and as long as it needs; the header row is repeated on every printed page (the name below).
    + '<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>'
    + '<pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>'
    + '</worksheet>'

  return zipSync({
    '[Content_Types].xml': strToU8(`${XML_HEADER}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      + '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
      + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
      + '</Types>'),
    '_rels/.rels': strToU8(`${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
      + '</Relationships>'),
    'xl/workbook.xml': strToU8(`${XML_HEADER}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" `
      + 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
      + `<sheets><sheet name="${xml(name)}" sheetId="1" r:id="rId1"/></sheets>`
      + `<definedNames><definedName name="_xlnm.Print_Titles" localSheetId="0">'${xml(name.replace(/'/g, "''"))}'!$1:$1</definedName></definedNames></workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8(`${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
      + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
      + '</Relationships>'),
    'xl/styles.xml': strToU8(XLSX_STYLES),
    'xl/worksheets/sheet1.xml': strToU8(sheet),
  })
}

// --- Word ------------------------------------------------------------------

// A4, landscape, 2 cm margins: the table has room for its nine columns. The widths below are twentieths of a point.
const DOCX_PAGE_WIDTH = 16838
const DOCX_PAGE_HEIGHT = 11906
const DOCX_MARGIN = 1134
const DOCX_TABLE_WIDTH = DOCX_PAGE_WIDTH - 2 * DOCX_MARGIN

type Align = 'left' | 'center'

interface DocxColumn {
  /** The column that carries the card's name (and the English one under it). */
  isName?: true
  label: string
  /** Relative width; the columns share the page width in these proportions. */
  weight: number
  align: Align
  cell: (card: InventoryExportCard) => string
}

interface RunOptions {
  bold?: boolean
  color?: string
  /** Half points. */
  size?: number
}

/** Text as runs; a line break in it (a note with two lines) becomes a Word line break. */
function docxRuns(text: string, options: RunOptions = {}): string {
  const props = (options.bold ? '<w:b/><w:bCs/>' : '')
    + (options.color ? `<w:color w:val="${options.color}"/>` : '')
    + (options.size ? `<w:sz w:val="${options.size}"/><w:szCs w:val="${options.size}"/>` : '')
  const rPr = props ? `<w:rPr>${props}</w:rPr>` : ''
  return text
    .split(/\r?\n/)
    .map(line => `<w:r>${rPr}<w:t xml:space="preserve">${xml(line)}</w:t></w:r>`)
    .join(`<w:r>${rPr}<w:br/></w:r>`)
}

function docxParagraph(runs: string, options: { style?: string, align?: Align, keepNext?: boolean } = {}): string {
  const props = (options.style ? `<w:pStyle w:val="${options.style}"/>` : '')
    + (options.keepNext ? '<w:keepNext/>' : '')
    + (options.align === 'center' ? '<w:jc w:val="center"/>' : '')
  return `<w:p>${props ? `<w:pPr>${props}</w:pPr>` : ''}${runs}</w:p>`
}

function docxColumns(doc: InventoryExportDocument): DocxColumn[] {
  const { labels } = doc
  const stat = (value: ExportStat) => (value === null ? '' : String(value))
  const columns: Array<DocxColumn | null> = [
    { label: labels.quantity, weight: 9, align: 'center', cell: card => String(card.quantity) },
    { isName: true, label: labels.name, weight: 36, align: 'left', cell: card => card.name },
    { label: labels.type, weight: 22, align: 'left', cell: card => card.type },
    { label: labels.attribute, weight: 12, align: 'left', cell: card => card.attribute },
    { label: labels.race, weight: 16, align: 'left', cell: card => card.race },
    { label: labels.level, weight: 10, align: 'left', cell: card => card.level },
    { label: labels.atk, weight: 8, align: 'center', cell: card => stat(card.atk) },
    { label: labels.def, weight: 8, align: 'center', cell: card => stat(card.def) },
    hasAny(doc, card => card.note) ? { label: labels.note, weight: 26, align: 'left', cell: card => card.note } : null,
  ]
  return columns.filter((column): column is DocxColumn => column !== null)
}

function docxTable(doc: InventoryExportDocument, columns: DocxColumn[], widths: number[], cards: InventoryExportCard[]): string {
  const grid = `<w:tblGrid>${widths.map(width => `<w:gridCol w:w="${width}"/>`).join('')}</w:tblGrid>`

  const header = '<w:tr><w:trPr><w:cantSplit/><w:tblHeader/></w:trPr>'
    + columns.map((column, index) => `<w:tc><w:tcPr><w:tcW w:w="${widths[index]}" w:type="dxa"/>`
      + '<w:shd w:val="clear" w:color="auto" w:fill="E7E6E6"/></w:tcPr>'
      + `${docxParagraph(docxRuns(column.label, { bold: true }), { align: column.align })}</w:tc>`).join('')
    + '</w:tr>'

  const body = cards.map((card) => {
    const cells = columns.map((column, index) => {
      let runs = docxRuns(column.cell(card))
      // The English name under the one in the card language, small and grey.
      if (column.isName && card.englishName) {
        runs += `<w:r><w:br/></w:r>${docxRuns(card.englishName, { color: '7F7F7F', size: 17 })}`
      }
      return `<w:tc><w:tcPr><w:tcW w:w="${widths[index]}" w:type="dxa"/></w:tcPr>${docxParagraph(runs, { align: column.align })}</w:tc>`
    })
    return `<w:tr><w:trPr><w:cantSplit/></w:trPr>${cells.join('')}</w:tr>`
  }).join('')

  return '<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/>'
    + `<w:tblW w:w="${DOCX_TABLE_WIDTH}" w:type="dxa"/><w:tblLayout w:type="fixed"/>`
    + '<w:tblCellMar><w:top w:w="40" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="40" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar>'
    + `<w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr>${grid}${header}${body}</w:tbl>`
}

function docxStyles(lang: string): string {
  const border = (side: string) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>`
  return `${XML_HEADER}<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">`
    + '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/>'
    + `<w:sz w:val="20"/><w:szCs w:val="20"/><w:lang w:val="${xml(lang)}" w:eastAsia="${xml(lang)}" w:bidi="ar-SA"/></w:rPr></w:rPrDefault>`
    + '<w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>'
    + '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>'
    + '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>'
    + '<w:pPr><w:spacing w:after="60"/></w:pPr><w:rPr><w:b/><w:bCs/><w:sz w:val="44"/><w:szCs w:val="44"/></w:rPr></w:style>'
    + '<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>'
    + '<w:pPr><w:spacing w:after="240"/></w:pPr><w:rPr><w:color w:val="595959"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:style>'
    + '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>'
    + '<w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="320" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr>'
    + '<w:rPr><w:b/><w:bCs/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr></w:style>'
    + '<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:uiPriority w:val="99"/><w:semiHidden/><w:unhideWhenUsed/>'
    + '<w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/>'
    + '<w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>'
    + '<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:basedOn w:val="TableNormal"/><w:uiPriority w:val="39"/>'
    + `<w:tblPr><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(border).join('')}</w:tblBorders></w:tblPr></w:style>`
    + '</w:styles>'
}

/** The inventory as a Word document: a title, then one table per collection under its heading (A4, landscape). */
export function encodeDocx(doc: InventoryExportDocument): Uint8Array {
  const columns = docxColumns(doc)
  const totalWeight = columns.reduce((sum, column) => sum + column.weight, 0)
  const widths = columns.map(column => Math.floor(DOCX_TABLE_WIDTH * column.weight / totalWeight))
  // The rounding remainder goes to the name column, so the grid adds up to the table's width exactly.
  const nameIndex = Math.max(0, columns.findIndex(column => column.isName))
  widths[nameIndex] = (widths[nameIndex] ?? 0) + DOCX_TABLE_WIDTH - widths.reduce((sum, width) => sum + width, 0)

  const body = [
    docxParagraph(docxRuns(doc.title), { style: 'Title' }),
    docxParagraph(docxRuns(doc.subtitle), { style: 'Subtitle' }),
    ...doc.groups.flatMap(group => [
      docxParagraph(docxRuns(group.heading), { style: 'Heading1' }),
      docxTable(doc, columns, widths, group.cards),
    ]),
    // A table may not be the last thing in the body.
    '<w:p/>',
  ].join('')

  const document = `${XML_HEADER}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">`
    + `<w:body>${body}<w:sectPr><w:pgSz w:w="${DOCX_PAGE_WIDTH}" w:h="${DOCX_PAGE_HEIGHT}" w:orient="landscape"/>`
    + `<w:pgMar w:top="${DOCX_MARGIN}" w:right="${DOCX_MARGIN}" w:bottom="${DOCX_MARGIN}" w:left="${DOCX_MARGIN}" w:header="567" w:footer="567" w:gutter="0"/>`
    + '</w:sectPr></w:body></w:document>'

  return zipSync({
    '[Content_Types].xml': strToU8(`${XML_HEADER}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
      + '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
      + '</Types>'),
    '_rels/.rels': strToU8(`${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
      + '</Relationships>'),
    'word/_rels/document.xml.rels': strToU8(`${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
      + '</Relationships>'),
    'word/styles.xml': strToU8(docxStyles(doc.lang)),
    'word/document.xml': strToU8(document),
  })
}

// --- Text ------------------------------------------------------------------

/**
 * The inventory as text: `3x Dark Magician`, one card per line, under a `# heading` per collection. The headings are comments to
 * the quick-entry parser (a line starting with `#`), so the list can be pasted into "Schnellerfassung" again.
 */
export function encodeInventoryText(doc: InventoryExportDocument): string {
  const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim()
  const lines = [`# ${oneLine(doc.title)}`, `# ${oneLine(doc.subtitle)}`]
  for (const group of doc.groups) {
    lines.push('', `# ${oneLine(group.heading)}`)
    for (const card of group.cards) {
      lines.push(`${card.quantity}x ${oneLine(card.name)}`)
    }
  }
  return `${lines.join('\r\n')}\r\n`
}

// --- Any format -------------------------------------------------------------

/** The file's content for the browser's Blob. */
export function encodeInventoryExport(format: InventoryExportFormat, doc: InventoryExportDocument): BlobPart {
  switch (format) {
    case 'xlsx':
      return encodeXlsx(doc) as BlobPart
    case 'docx':
      return encodeDocx(doc) as BlobPart
    case 'txt':
      return encodeInventoryText(doc)
  }
}

/**
 * `inventar-ohne-sammlung-2026-11-16.xlsx`: the scope (a collection's name, "Alle Karten") as a file name and the day.
 * `date` is the local day, `YYYY-MM-DD`.
 */
export function inventoryExportFileName(scope: string, date: string, format: InventoryExportFormat, stem = 'inventar'): string {
  const name = scope.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 50).replace(/-+$/g, '')
  return `${[stem, name, date].filter(Boolean).join('-')}.${format}`
}
