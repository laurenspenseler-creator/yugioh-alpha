// The inventory export (ADR 0051): the Excel, Word and text files, and the rows they are made of.
import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import {
  encodeDocx,
  encodeInventoryExport,
  encodeInventoryText,
  encodeXlsx,
  exportCopies,
  INVENTORY_EXPORT_FORMATS,
  inventoryExportFileName,
} from '../../shared/inventory-export'
import type { InventoryExportCard, InventoryExportDocument, InventoryExportRow } from '../../shared/inventory-export'
import { parseEntryText } from '../../server/utils/card-entry'
import { inventoryExportGroups, inventoryExportTotals, passcodeText } from '../../app/utils/inventory-export'
import type { InventoryExportWords } from '../../app/utils/inventory-export'
import { readXlsx, rowsToEntryLines } from '../../app/utils/spreadsheet-list'

const labels: InventoryExportDocument['labels'] = {
  sheet: 'Inventar',
  quantity: 'Anzahl',
  name: 'Name',
  englishName: 'Englischer Name',
  collection: 'Sammlung',
  type: 'Typ',
  attribute: 'Attribut',
  race: 'Monsterart',
  level: 'Stufe/Rang',
  atk: 'ATK',
  def: 'DEF',
  passcode: 'Passcode',
  note: 'Notiz',
}

function card(overrides: Partial<InventoryExportCard> = {}): InventoryExportCard {
  return {
    quantity: 1,
    name: 'Dark Magician',
    englishName: null,
    passcode: '46986414',
    type: 'Normal Monster',
    attribute: 'DARK',
    race: 'Spellcaster',
    level: 'Level 7',
    atk: 2500,
    def: 2100,
    note: '',
    ...overrides,
  }
}

function documentWith(groups: InventoryExportDocument['groups']): InventoryExportDocument {
  return { title: 'Inventar – Alle Karten', subtitle: '4 Karten · Stand 16. November 2026', lang: 'de-DE', labels, groups }
}

const binder = {
  title: 'Binder A',
  heading: 'Binder A · 4 Karten',
  cards: [
    card({ quantity: 3, name: 'Dark Magician' }),
    card({ quantity: 1, name: 'Pot of Greed', passcode: '55144522', type: 'Spell Card', attribute: '', race: 'Normal', level: '', atk: null, def: null }),
  ],
}
const loose = {
  title: '(keine Sammlung)',
  heading: '(keine Sammlung) · 2 Karten',
  cards: [card({ quantity: 2, name: 'Kuriboh', passcode: '40640057', atk: 300, def: 200, level: 'Level 1' })],
}

function xmlParts(bytes: Uint8Array): Record<string, string> {
  return Object.fromEntries(Object.entries(unzipSync(bytes)).map(([name, data]) => [name, strFromU8(data)]))
}

describe('the Excel file', () => {
  it('is a workbook with the parts Excel needs and one sheet named after the label', () => {
    const parts = xmlParts(encodeXlsx(documentWith([binder])))

    expect(Object.keys(parts)).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/workbook.xml',
      'xl/_rels/workbook.xml.rels',
      'xl/styles.xml',
      'xl/worksheets/sheet1.xml',
    ])
    expect(parts['xl/workbook.xml']).toContain('<sheet name="Inventar" sheetId="1" r:id="rId1"/>')
    expect(parts['[Content_Types].xml']).toContain('/xl/worksheets/sheet1.xml')
  })

  it('has a header row, one row per card and collection, and numbers where they are numbers', () => {
    const rows = readXlsx(encodeXlsx(documentWith([binder, loose])))

    expect(rows[0]).toEqual(['Anzahl', 'Name', 'Sammlung', 'Typ', 'Attribut', 'Monsterart', 'Stufe/Rang', 'ATK', 'DEF', 'Passcode'])
    expect(rows).toHaveLength(4)
    // The Spell has no attribute, level, ATK or DEF: empty cells, not zeros.
    expect(rows[1]).toEqual([3, 'Dark Magician', 'Binder A', 'Normal Monster', 'DARK', 'Spellcaster', 'Level 7', 2500, 2100, '46986414'])
    expect(rows[2]!.slice(0, 4)).toEqual([1, 'Pot of Greed', 'Binder A', 'Spell Card'])
    expect(rows[2]!.slice(4, 9).filter(cell => cell !== null && cell !== undefined && cell !== 'Normal')).toEqual([])
    expect(rows[3]).toEqual([2, 'Kuriboh', '(keine Sammlung)', 'Normal Monster', 'DARK', 'Spellcaster', 'Level 1', 300, 200, '40640057'])
  })

  it('keeps a passcode with leading zeros as text and a "?" stat as text, and ATK 0 as a number', () => {
    const rows = readXlsx(encodeXlsx(documentWith([{
      title: 'A',
      heading: 'A',
      cards: [card({ passcode: '00000001', atk: '?', def: 0 })],
    }])))

    expect(rows[1]!.slice(-3)).toEqual(['?', 0, '00000001'])
  })

  it('adds the English name and the note columns only when some card has one', () => {
    const plain = readXlsx(encodeXlsx(documentWith([binder])))[0]!
    expect(plain).not.toContain('Englischer Name')
    expect(plain).not.toContain('Notiz')

    const rows = readXlsx(encodeXlsx(documentWith([{
      title: 'A',
      heading: 'A',
      cards: [card({ name: 'Dunkler Magier', englishName: 'Dark Magician', note: 'Aus dem Starterdeck' })],
    }])))
    expect(rows[0]).toContain('Englischer Name')
    expect(rows[0]!.at(-1)).toBe('Notiz')
    expect(rows[1]).toContain('Dark Magician')
    expect(rows[1]!.at(-1)).toBe('Aus dem Starterdeck')
  })

  it('writes the characters of XML as text and drops the ones XML forbids', () => {
    const bytes = encodeXlsx(documentWith([{
      title: 'Tom & Jerry <3 "x"',
      heading: 'h',
      cards: [card({ name: 'A & B <C> "D"', note: 'bad\u0001char' })],
    }]))
    const sheet = xmlParts(bytes)['xl/worksheets/sheet1.xml']!

    expect(sheet).toContain('A &amp; B &lt;C&gt; &quot;D&quot;')
    expect(sheet).not.toContain('\u0001')
    const rows = readXlsx(bytes)
    expect(rows[1]).toContain('A & B <C> "D"')
    expect(rows[1]).toContain('badchar')
    expect(rows[1]).toContain('Tom & Jerry <3 "x"')
  })

  it('freezes and filters the header row over the whole table', () => {
    const sheet = xmlParts(encodeXlsx(documentWith([binder, loose])))['xl/worksheets/sheet1.xml']!

    expect(sheet).toContain('state="frozen"')
    expect(sheet).toContain('<dimension ref="A1:J4"/>')
    expect(sheet).toContain('<autoFilter ref="A1:J4"/>')
    expect(sheet).toContain('<c r="A1" s="1" t="inlineStr">')
  })

  it('prints on A4 landscape as wide as the page, with the header row on every page', () => {
    const parts = xmlParts(encodeXlsx({ ...documentWith([binder]), labels: { ...labels, sheet: 'Dan\'s <Karten>' } }))

    expect(parts['xl/worksheets/sheet1.xml']).toContain('<pageSetUpPr fitToPage="1"/>')
    expect(parts['xl/worksheets/sheet1.xml']).toContain('<pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>')
    // The sheet's name in the reference is quoted, an apostrophe in it doubled.
    expect(parts['xl/workbook.xml']).toContain('<definedName name="_xlnm.Print_Titles" localSheetId="0">\'Dan\'\'s &lt;Karten&gt;\'!$1:$1</definedName>')
  })

  it('names the sheet with something Excel accepts', () => {
    const named = (sheet: string) => xmlParts(encodeXlsx({ ...documentWith([binder]), labels: { ...labels, sheet } }))['xl/workbook.xml']!

    expect(named('A/B:C?D*E[F]G')).toContain('name="A B C D E F G"')
    expect(named('x'.repeat(40))).toContain(`name="${'x'.repeat(31)}"`)
    expect(named('///')).toContain('name="Sheet1"')
  })

  it('can be read back as a card list by the quick-entry importer', () => {
    const { lines, header } = rowsToEntryLines(readXlsx(encodeXlsx(documentWith([binder, loose]))))

    expect(header).toBe(true)
    expect(lines).toEqual(['3x Dark Magician', '1x Pot of Greed', '2x Kuriboh'])
  })
})

describe('the Word file', () => {
  it('is a document with its styles, in landscape A4', () => {
    const parts = xmlParts(encodeDocx(documentWith([binder])))

    expect(Object.keys(parts)).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'word/_rels/document.xml.rels',
      'word/styles.xml',
      'word/document.xml',
    ])
    expect(parts['word/document.xml']).toContain('<w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/>')
    expect(parts['word/styles.xml']).toContain('w:styleId="Heading1"')
    expect(parts['word/styles.xml']).toContain('w:styleId="TableGrid"')
    expect(parts['word/styles.xml']).toContain('<w:lang w:val="de-DE"')
  })

  it('has the title, the subtitle and one heading with a table per collection', () => {
    const document = xmlParts(encodeDocx(documentWith([binder, loose])))['word/document.xml']!

    expect(document).toContain('Inventar – Alle Karten')
    expect(document).toContain('Stand 16. November 2026')
    expect(document.match(/<w:tbl>/g)).toHaveLength(2)
    // Per table the header row and one row per card: 1 + 2 and 1 + 1.
    expect(document.match(/<w:tr>/g)).toHaveLength(5)
    expect(document.indexOf('Binder A · 4 Karten')).toBeLessThan(document.indexOf('(keine Sammlung) · 2 Karten'))
    expect(document.match(/<w:pStyle w:val="Heading1"\/>/g)).toHaveLength(2)
  })

  it('repeats the header row on every page and keeps a row on one page', () => {
    const document = xmlParts(encodeDocx(documentWith([binder])))['word/document.xml']!

    expect(document).toContain('<w:trPr><w:cantSplit/><w:tblHeader/></w:trPr>')
    expect(document.match(/<w:cantSplit\/>/g)).toHaveLength(3)
  })

  it('lets the columns add up to the width of the table, with and without the note column', () => {
    const widthOf = (doc: InventoryExportDocument) => {
      const document = xmlParts(encodeDocx(doc))['word/document.xml']!
      const grid = /<w:tblGrid>(.*?)<\/w:tblGrid>/.exec(document)![1]!
      return [...grid.matchAll(/w:w="(\d+)"/g)].map(match => Number(match[1]))
    }
    const without = widthOf(documentWith([binder]))
    const withNote = widthOf(documentWith([{ title: 'A', heading: 'A', cards: [card({ note: 'x' })] }]))

    expect(without).toHaveLength(8)
    expect(withNote).toHaveLength(9)
    expect(without.reduce((sum, width) => sum + width, 0)).toBe(16838 - 2 * 1134)
    expect(withNote.reduce((sum, width) => sum + width, 0)).toBe(16838 - 2 * 1134)
  })

  it('puts the English name under the name, and turns a line break of a note into a Word one', () => {
    const document = xmlParts(encodeDocx(documentWith([{
      title: 'A',
      heading: 'A',
      cards: [card({ name: 'Dunkler Magier', englishName: 'Dark Magician', note: 'zwei\nZeilen' })],
    }])))['word/document.xml']!

    expect(document).toContain('Dunkler Magier')
    expect(document).toMatch(/Dunkler Magier<\/w:t><\/w:r><w:r><w:br\/><\/w:r><w:r><w:rPr><w:color w:val="7F7F7F"\/>.*?Dark Magician/)
    expect(document).toMatch(/zwei<\/w:t><\/w:r><w:r><w:br\/><\/w:r><w:r><w:t xml:space="preserve">Zeilen/)
  })

  it('escapes the characters of XML and ends with a paragraph, not a table', () => {
    const document = xmlParts(encodeDocx(documentWith([{ title: 'A', heading: 'R&D <x>', cards: [card({ name: 'A & B' })] }])))['word/document.xml']!

    expect(document).toContain('R&amp;D &lt;x&gt;')
    expect(document).toContain('A &amp; B')
    expect(document).toMatch(/<\/w:tbl><w:p\/><w:sectPr>/)
  })
})

describe('the text file', () => {
  it('lists `3x Name` under a comment line per collection, with Windows line breaks', () => {
    const text = encodeInventoryText(documentWith([binder, loose]))

    expect(text).toBe([
      '# Inventar – Alle Karten',
      '# 4 Karten · Stand 16. November 2026',
      '',
      '# Binder A · 4 Karten',
      '3x Dark Magician',
      '1x Pot of Greed',
      '',
      '# (keine Sammlung) · 2 Karten',
      '2x Kuriboh',
      '',
    ].join('\r\n'))
  })

  it('can be pasted into quick entry again: the comments are skipped, the cards keep their copies', () => {
    const lines = parseEntryText(encodeInventoryText(documentWith([binder, loose])))

    expect(lines.map(line => [line.quantity, line.query])).toEqual([
      [3, 'Dark Magician'],
      [1, 'Pot of Greed'],
      [2, 'Kuriboh'],
    ])
  })

  it('keeps a name on one line', () => {
    const text = encodeInventoryText(documentWith([{ title: 'A', heading: 'A', cards: [card({ name: 'Two\nLines' })] }]))

    expect(text).toContain('1x Two Lines')
  })
})

describe('encoding by format', () => {
  it('gives text for txt and bytes for xlsx and docx, and knows the three formats', () => {
    const doc = documentWith([binder])

    expect(INVENTORY_EXPORT_FORMATS).toEqual(['xlsx', 'docx', 'txt'])
    expect(typeof encodeInventoryExport('txt', doc)).toBe('string')
    expect(encodeInventoryExport('xlsx', doc)).toBeInstanceOf(Uint8Array)
    expect(encodeInventoryExport('docx', doc)).toBeInstanceOf(Uint8Array)
  })

  it('counts the copies of a document', () => {
    expect(exportCopies(documentWith([binder, loose]))).toBe(6)
  })

  it('names the file after the scope and the day', () => {
    expect(inventoryExportFileName('Alle Karten', '2026-11-16', 'xlsx')).toBe('inventar-alle-karten-2026-11-16.xlsx')
    expect(inventoryExportFileName('Binder: Käfer & Co.', '2026-11-16', 'docx', 'inventory')).toBe('inventory-binder-käfer-co-2026-11-16.docx')
    expect(inventoryExportFileName('???', '2026-11-16', 'txt')).toBe('inventar-2026-11-16.txt')
  })
})

describe('the rows as a document', () => {
  const words: InventoryExportWords = {
    cardName: ({ name, nameDe }) => nameDe ?? name,
    englishName: ({ name, nameDe }) => (nameDe && nameDe !== name ? name : null),
    cardValue: (_kind, value) => value.toUpperCase(),
    levelLabel: ({ level, type }) => (level === null ? null : `${/xyz/i.test(type) ? 'Rang' : 'Stufe'} ${level}`),
    noCollection: '(keine Sammlung)',
    heading: (name, copies) => `${name} · ${copies}`,
  }

  function row(overrides: Partial<InventoryExportRow>): InventoryExportRow {
    return {
      catalogCardId: 46986414,
      collectionId: 'c1',
      collectionName: 'Binder A',
      quantity: 1,
      note: null,
      name: 'Dark Magician',
      nameDe: 'Dunkler Magier',
      type: 'Normal Monster',
      attribute: 'DARK',
      race: 'Spellcaster',
      level: 7,
      linkval: null,
      atk: 2500,
      def: 2100,
      ...overrides,
    }
  }

  it('writes the card in the card language, with the English name beside it', () => {
    const [group] = inventoryExportGroups([row({ quantity: 3, note: '  Starter  ' })], words)

    expect(group!.cards[0]).toEqual({
      quantity: 3,
      name: 'Dunkler Magier',
      englishName: 'Dark Magician',
      passcode: '46986414',
      type: 'NORMAL MONSTER',
      attribute: 'DARK',
      race: 'SPELLCASTER',
      level: 'Stufe 7',
      atk: 2500,
      def: 2100,
      note: 'Starter',
    })
  })

  it('starts a group where the collection changes, the copies without one last, with their number of copies in the heading', () => {
    const groups = inventoryExportGroups([
      row({ quantity: 3 }),
      row({ catalogCardId: 40640057, name: 'Kuriboh', nameDe: null, quantity: 2 }),
      row({ collectionId: 'c2', collectionName: 'Box', quantity: 1 }),
      row({ collectionId: null, collectionName: null, quantity: 4 }),
    ], words)

    expect(groups.map(group => [group.title, group.heading, group.cards.length])).toEqual([
      ['Binder A', 'Binder A · 5', 2],
      ['Box', 'Box · 1', 1],
      ['(keine Sammlung)', '(keine Sammlung) · 4', 1],
    ])
    expect(groups[0]!.cards[1]!.englishName).toBeNull()
  })

  it('shows a stat printed "?" as "?", pads a short passcode and leaves a Spell\'s empty fields empty', () => {
    const [group] = inventoryExportGroups([
      row({ catalogCardId: 1, atk: -1, def: -1 }),
      row({ type: 'Spell Card', attribute: null, race: 'Normal', level: null, atk: null, def: null }),
    ], words)

    expect(group!.cards[0]).toMatchObject({ passcode: '00000001', atk: '?', def: '?' })
    expect(group!.cards[1]).toMatchObject({ attribute: '', level: '', atk: null, def: null })
    expect(passcodeText(46986414)).toBe('46986414')
  })

  it('gives no group for no rows, and counts copies and different cards', () => {
    expect(inventoryExportGroups([], words)).toEqual([])
    expect(inventoryExportTotals([row({ quantity: 3 }), row({ collectionId: 'c2', quantity: 2 }), row({ catalogCardId: 7 })]))
      .toEqual({ copies: 6, kinds: 2 })
  })
})
