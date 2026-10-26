import { createError } from 'h3'
import { getDocumentProxy } from 'unpdf'
import { RULEBOOK_MAX_CHARS, RULEBOOK_PDF_MAX_MB } from '../../shared/format-rulebook'

/** The most pages and characters read from one PDF; a rulebook is a few pages. */
export const PDF_MAX_PAGES = 60
export const PDF_MAX_CHARS = RULEBOOK_MAX_CHARS
export const RULEBOOK_PDF_MAX_BYTES = RULEBOOK_PDF_MAX_MB * 1024 * 1024

interface TextItem {
  str: string
  transform: number[]
  hasEOL?: boolean
}

/**
 * The text of a PDF, one printed line per line: text pieces that sit at the
 * same height are joined left to right, lines run top to bottom, pages one
 * after the other. No OCR: a scanned PDF has no text and gives an empty string.
 */
export async function extractPdfText(bytes: Uint8Array): Promise<string> {
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>>
  try {
    // pdf.js wants a plain Uint8Array (not a Buffer) and takes ownership of it.
    pdf = await getDocumentProxy(new Uint8Array(bytes))
  }
  catch {
    throw createError({ statusCode: 400, statusMessage: 'The file is not a readable PDF', data: { code: 'pdf_unreadable' } })
  }

  const out: string[] = []
  try {
    for (let pageNumber = 1; pageNumber <= Math.min(pdf.numPages, PDF_MAX_PAGES); pageNumber += 1) {
      const page = await pdf.getPage(pageNumber)
      const content = await page.getTextContent()
      const rows = new Map<number, Array<{ x: number, text: string }>>()
      for (const item of content.items as TextItem[]) {
        if (typeof item.str !== 'string' || item.str === '') {
          continue
        }
        const y = Math.round(item.transform[5] ?? 0)
        const key = [...rows.keys()].find(known => Math.abs(known - y) <= 2) ?? y
        const row = rows.get(key) ?? []
        row.push({ x: item.transform[4] ?? 0, text: item.str })
        rows.set(key, row)
      }
      for (const key of [...rows.keys()].sort((a, b) => b - a)) {
        const line = rows.get(key)!.sort((a, b) => a.x - b.x).map(part => part.text).join(' ').replace(/\s+/g, ' ').trim()
        if (line !== '') {
          out.push(line)
        }
      }
    }
  }
  catch {
    throw createError({ statusCode: 400, statusMessage: 'The PDF could not be read', data: { code: 'pdf_unreadable' } })
  }

  return out.join('\n').slice(0, PDF_MAX_CHARS)
}
