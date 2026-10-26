import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import {
  cardCandidates,
  isImportableFileName,
  parseCsv,
  readCardCandidates,
  readXlsx,
  rowsToEntryLines,
  SPREADSHEET_MAX_BYTES,
  SPREADSHEET_MAX_LINES,
  SpreadsheetError,
} from '../../app/utils/spreadsheet-list'
import type { Cell } from '../../app/utils/spreadsheet-list'

const escapeXml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const columnName = (index: number) => String.fromCharCode(65 + index)

interface SheetSpec {
  name: string
  rows: Cell[][]
  state?: string
}

/** A minimal .xlsx the way Excel lays it out: shared strings, numbers, sparse cells. */
function makeXlsx(sheets: SheetSpec[], options: { inlineStrings?: boolean } = {}): Uint8Array {
  const shared: string[] = []
  const sharedIndex = (text: string) => {
    const found = shared.indexOf(text)
    if (found >= 0) {
      return found
    }
    shared.push(text)
    return shared.length - 1
  }

  const files: Record<string, Uint8Array> = {}
  sheets.forEach((sheet, sheetNumber) => {
    const rows = sheet.rows.map((row, rowNumber) => {
      const cells = row.map((cell, column) => {
        const ref = `${columnName(column)}${rowNumber + 1}`
        if (cell === null) {
          return ''
        }
        if (typeof cell === 'number') {
          return `<c r="${ref}"><v>${cell}</v></c>`
        }
        if (typeof cell === 'boolean') {
          return `<c r="${ref}" t="b"><v>${cell ? 1 : 0}</v></c>`
        }
        return options.inlineStrings
          ? `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(cell)}</t></is></c>`
          : `<c r="${ref}" t="s"><v>${sharedIndex(cell)}</v></c>`
      }).join('')
      return `<row r="${rowNumber + 1}">${cells}</row>`
    }).join('')
    files[`xl/worksheets/sheet${sheetNumber + 1}.xml`] = strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`,
    )
  })

  files['xl/workbook.xml'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${
      sheets.map((sheet, index) => `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}"${sheet.state ? ` state="${sheet.state}"` : ''} r:id="rId${index + 1}"/>`).join('')
    }</sheets></workbook>`,
  )
  files['xl/_rels/workbook.xml.rels'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${
      sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('')
    }</Relationships>`,
  )
  if (!options.inlineStrings) {
    files['xl/sharedStrings.xml'] = strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${shared.length}" uniqueCount="${shared.length}">${
        shared.map(text => `<si><t>${escapeXml(text)}</t></si>`).join('')
      }</sst>`,
    )
  }
  files['[Content_Types].xml'] = strToU8('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>')
  return zipSync(files)
}

describe('parseCsv', () => {
  it('reads a German Excel export: semicolons, quotes, a BOM and a quoted line break', () => {
    const rows = parseCsv('\uFEFFName;Menge;Set\r\n"Dunkler Magier";3;SDY-006\r\n"Brecher, ""der"" Krieger";1;\r\n"Zwei\nZeilen";2;')

    expect(rows).toEqual([
      ['Name', 'Menge', 'Set'],
      ['Dunkler Magier', '3', 'SDY-006'],
      ['Brecher, "der" Krieger', '1', ''],
      ['Zwei\nZeilen', '2', ''],
    ])
  })

  it('reads comma and tab separated files', () => {
    expect(parseCsv('name,qty\nKuriboh,2')).toEqual([['name', 'qty'], ['Kuriboh', '2']])
    expect(parseCsv('name\tqty\nKuriboh\t2')).toEqual([['name', 'qty'], ['Kuriboh', '2']])
  })

  it('keeps a plain list with commas in some names as one column', () => {
    expect(parseCsv('3x Brecher, Magischer Krieger\nKuriboh\n2x Dunkler Magier')).toEqual([
      ['3x Brecher, Magischer Krieger'],
      ['Kuriboh'],
      ['2x Dunkler Magier'],
    ])
  })
})

describe('rowsToEntryLines', () => {
  it('uses the header row: name, quantity and set code columns', () => {
    const result = rowsToEntryLines([
      ['Kartenname', 'Anzahl', 'Set-Code', 'Seltenheit'],
      ['Dunkler Magier', 3, 'sdy-006', 'Ultra'],
      ['Kuriboh', '2', '', ''],
      ['Leer', '', '', ''],
      ['', 1, '', ''],
      ['Null', 0, '', ''],
    ])

    expect(result.lines).toEqual(['3x Dunkler Magier (SDY-006)', '2x Kuriboh'])
    expect(result.skipped).toBe(3)
  })

  it('finds the header below a title row and reads English headers', () => {
    const result = rowsToEntryLines([
      ['My collection'],
      ['Card Name', 'Qty'],
      ['Dark Magician', 1],
    ])

    expect(result.lines).toEqual(['1x Dark Magician'])
  })

  it('ignores a set column that holds set names rather than codes', () => {
    const result = rowsToEntryLines([
      ['Name', 'Menge', 'Set'],
      ['Kuriboh', 2, 'Legend of Blue Eyes White Dragon'],
    ])

    expect(result.lines).toEqual(['2x Kuriboh'])
  })

  it('guesses the columns without a header: quantity first, or name first', () => {
    expect(rowsToEntryLines([['3', 'Dark Magician'], ['1', 'Kuriboh']]).lines).toEqual(['3x Dark Magician', '1x Kuriboh'])
    expect(rowsToEntryLines([['Dark Magician', 3], ['Kuriboh', 1]]).lines).toEqual(['3x Dark Magician', '1x Kuriboh'])
    expect(rowsToEntryLines([['Dark Magician', 3, 'SDY-006'], ['Kuriboh', 1, 'LOB-001']]).lines).toEqual([
      '3x Dark Magician (SDY-006)',
      '1x Kuriboh (LOB-001)',
    ])
  })

  it('passes a one-column list through as the lines quick capture reads', () => {
    expect(rowsToEntryLines([['3x Dark Magician'], ['Kuriboh'], ['46986414']]).lines).toEqual(['3x Dark Magician', 'Kuriboh', '46986414'])
    expect(rowsToEntryLines([['Name'], ['Kuriboh']]).lines).toEqual(['Kuriboh'])
  })

  it('accepts a passcode in the name column and "3x" as a quantity', () => {
    expect(rowsToEntryLines([['Name', 'Menge'], [46986414, '3x']]).lines).toEqual(['3x 46986414'])
  })

  it('skips blank rows and answers nothing for an empty sheet', () => {
    expect(rowsToEntryLines([[null, null], ['Name', 'Menge'], [null, null], ['Kuriboh', 1]]).lines).toEqual(['1x Kuriboh'])
    expect(rowsToEntryLines([])).toEqual({ lines: [], skipped: 0, header: false })
  })

  it('reads "Karten" as a count, not as the card name, and skips bare numbers', () => {
    const result = rowsToEntryLines([
      ['Priorität', 'Deck', 'Karten', 'Einschätzung'],
      [1, 'Exodia', 45, 'stark'],
      [2, 'Side', 15, 'Reserve'],
    ])

    // No card column is named, so the text column is guessed; the numbers are not cards.
    expect(result.header).toBe(false)
    expect(result.lines.some(line => /^\dx (45|15)$/.test(line))).toBe(false)
  })

  it('tells a card list with a name header from a sheet without one', () => {
    expect(rowsToEntryLines([['Name', 'Menge'], ['Kuriboh', 1]]).header).toBe(true)
    expect(rowsToEntryLines([['Kuriboh', 1], ['Raigeki', 2]]).header).toBe(false)
  })
})

describe('cardCandidates', () => {
  it('offers the sheets with a card-name header, in workbook order, and not a sheet of numbers', () => {
    const candidates = cardCandidates([
      { name: 'Übersicht', rows: [['Deck', 'Info'], ['Exodia', 'stark'], ['Side', 'Reserve'], ['Beatdown', 'schnell']] },
      { name: 'Decklisten', rows: [['Anzahl', 'Karte'], [3, 'Kuriboh'], [1, 'Raigeki']] },
      { name: 'Inventar', rows: [['Name', 'Menge'], ['Kuriboh', 2]] },
    ])

    expect(candidates.map(candidate => candidate.sheetName)).toEqual(['Decklisten', 'Inventar'])
    expect(candidates[1]).toMatchObject({ lines: ['2x Kuriboh'], header: true, truncated: false })
  })

  it('falls back to the sheets with cards when none has a header, and finds nothing in empty sheets', () => {
    expect(cardCandidates([
      { name: 'A', rows: [['Kuriboh', 1]] },
      { name: 'B', rows: [['Kuriboh', 1], ['Raigeki', 2]] },
    ]).map(candidate => candidate.sheetName)).toEqual(['A', 'B'])
    expect(cardCandidates([{ name: 'Leer', rows: [[null, null]] }])).toEqual([])
  })

  it('reads a long quantity header such as "Anzahl in aktueller Planung"', () => {
    const [candidate] = cardCandidates([
      { name: 'Inventar', rows: [['Name', 'Typ', 'Anzahl in aktueller Planung'], ['Kuriboh', 'Dämon', 3], ['Raigeki', 'Zauber', 1]] },
    ])

    expect(candidate!.lines).toEqual(['3x Kuriboh', '1x Raigeki'])
  })
})

describe('readXlsx', () => {
  it('reads shared strings, numbers and empty cells', () => {
    const rows = readXlsx(makeXlsx([{ name: 'Karten', rows: [['Name', 'Menge', 'Set'], ['Dunkler Magier', 3, null], ['Kuriboh', 2, 'LOB-001']] }]))

    // Excel writes no cell for an empty one at the end of a row.
    expect(rows).toEqual([
      ['Name', 'Menge', 'Set'],
      ['Dunkler Magier', 3],
      ['Kuriboh', 2, 'LOB-001'],
    ])
  })

  it('reads inline strings and keeps umlauts and XML special characters', () => {
    const rows = readXlsx(makeXlsx([{ name: 'S', rows: [['Name', 'Menge'], ['Blauäugiger w. Drache & Co <1>', 3]] }], { inlineStrings: true }))

    expect(rows[1]).toEqual(['Blauäugiger w. Drache & Co <1>', 3])
  })

  it('places cells by their reference when columns are skipped', () => {
    const rows = readXlsx(makeXlsx([{ name: 'S', rows: [[null, null, 'Name'], [null, null, 'Kuriboh']] }]))

    expect(rows).toEqual([[null, null, 'Name'], [null, null, 'Kuriboh']])
  })

  it('reads the first visible sheet', () => {
    const rows = readXlsx(makeXlsx([
      { name: 'Versteckt', state: 'hidden', rows: [['Name'], ['Falsch']] },
      { name: 'Karten', rows: [['Name'], ['Richtig']] },
    ]))

    expect(rows).toEqual([['Name'], ['Richtig']])
  })

  it('rejects bytes that are not a spreadsheet', () => {
    expect(() => readXlsx(strToU8('Das ist keine Excel-Datei'))).toThrowError(expect.objectContaining({ code: 'unreadable' }))
    expect(() => readXlsx(zipSync({ 'foo.txt': strToU8('x') }))).toThrowError(expect.objectContaining({ code: 'unreadable' }))
  })
})

describe('readCardCandidates', () => {
  it('turns an .xlsx card list into quick-capture lines', async () => {
    const bytes = makeXlsx([{ name: 'Karten', rows: [['Name', 'Menge'], ['Dunkler Magier', 3], ['Kuriboh', 1]] }])
    const candidates = await readCardCandidates(new Blob([bytes as BlobPart]), 'Sammlung.XLSX')

    expect(candidates).toEqual([{ lines: ['3x Dunkler Magier', '1x Kuriboh'], skipped: 0, header: true, truncated: false, sheetName: 'Karten' }])
  })

  it('returns every card sheet of a workbook so the user can pick one', async () => {
    const bytes = makeXlsx([
      { name: 'Übersicht', rows: [['Deck', 'Karten'], ['Exodia', 45]] },
      { name: 'Decklisten', rows: [['Anzahl', 'Karte'], [3, 'Kuriboh']] },
      { name: 'Inventar', rows: [['Kartenname', 'Anzahl'], ['Raigeki', 2]] },
    ])
    const candidates = await readCardCandidates(new Blob([bytes as BlobPart]), 'Mappe.xlsx')

    expect(candidates.map(candidate => [candidate.sheetName, candidate.lines])).toEqual([
      ['Decklisten', ['3x Kuriboh']],
      ['Inventar', ['2x Raigeki']],
    ])
  })

  it('turns a .csv and a plain text list into one candidate without a sheet', async () => {
    expect(await readCardCandidates(new Blob(['Name;Menge\nKuriboh;2']), 'liste.csv')).toMatchObject([{ lines: ['2x Kuriboh'], sheetName: null }])
    expect(await readCardCandidates(new Blob(['2x Kuriboh\nRaigeki']), 'liste.txt')).toMatchObject([{ lines: ['2x Kuriboh', 'Raigeki'] }])
  })

  it('cuts a very long list and says so', async () => {
    const rows = ['Name;Menge', ...Array.from({ length: SPREADSHEET_MAX_LINES + 5 }, (_, index) => `Karte ${index};1`)]
    const [candidate] = await readCardCandidates(new Blob([rows.join('\n')]), 'lang.csv')

    expect(candidate!.lines).toHaveLength(SPREADSHEET_MAX_LINES)
    expect(candidate!.truncated).toBe(true)
  })

  it('refuses unsupported, oversized, unreadable and empty files with a code', async () => {
    await expect(readCardCandidates(new Blob(['x']), 'alt.xls')).rejects.toMatchObject({ code: 'unsupported' })
    await expect(readCardCandidates(new Blob([new Uint8Array(SPREADSHEET_MAX_BYTES + 1)]), 'gross.csv')).rejects.toMatchObject({ code: 'tooLarge' })
    await expect(readCardCandidates(new Blob(['kaputt']), 'kaputt.xlsx')).rejects.toBeInstanceOf(SpreadsheetError)
    await expect(readCardCandidates(new Blob(['Name;Menge\n;']), 'leer.csv')).rejects.toMatchObject({ code: 'noCards' })
  })

  it('knows which files it can read', () => {
    for (const name of ['a.xlsx', 'a.XLSM', 'a.csv', 'a.tsv', 'a.txt', 'a.ydk']) {
      expect(isImportableFileName(name)).toBe(true)
    }
    for (const name of ['a.xls', 'a.ods', 'a.pdf', 'a']) {
      expect(isImportableFileName(name)).toBe(false)
    }
  })
})
