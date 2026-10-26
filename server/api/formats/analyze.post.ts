import { createError, getRequestHeader, readBody, readMultipartFormData } from 'h3'
import { useDb } from '../../db'
import { importRulebook } from '../../utils/format-import'
import { extractPdfText, PDF_MAX_CHARS, RULEBOOK_PDF_MAX_BYTES } from '../../utils/pdf-text'
import { requireUser } from '../../utils/session'

function fail(statusCode: number, message: string, code: string, params?: Record<string, unknown>): never {
  throw createError({ statusCode, statusMessage: message, data: { code, ...(params ? { params } : {}) } })
}

/**
 * `POST /api/formats/analyze` reads a format's written rules (ADR 0037): the
 * multipart field `file` (a PDF) or JSON `{ text }`, and answers with the rule
 * set it could build, the sentence-by-sentence findings of what the rule engine
 * can and can't enforce, and the name and description it found. Nothing is
 * saved: the format editor shows the result and the user saves it.
 */
export default defineEventHandler(async (event) => {
  await requireUser(event)

  let text: string
  let source: 'pdf' | 'text'

  if ((getRequestHeader(event, 'content-type') ?? '').startsWith('multipart/')) {
    source = 'pdf'
    if (Number(getRequestHeader(event, 'content-length') ?? 0) > RULEBOOK_PDF_MAX_BYTES + 1024 * 1024) {
      fail(413, 'The PDF is too large', 'format_file_too_large', { max: RULEBOOK_PDF_MAX_BYTES / (1024 * 1024) })
    }
    const part = (await readMultipartFormData(event) ?? []).find(item => item.name === 'file' && item.filename !== undefined)
    if (!part) {
      fail(400, 'No file in the request', 'format_file_required')
    }
    if (part.data.length > RULEBOOK_PDF_MAX_BYTES) {
      fail(413, 'The PDF is too large', 'format_file_too_large', { max: RULEBOOK_PDF_MAX_BYTES / (1024 * 1024) })
    }
    if (part.data.subarray(0, 5).toString('latin1') !== '%PDF-') {
      fail(400, 'The file is not a PDF', 'pdf_unreadable')
    }
    text = await extractPdfText(part.data)
    if (text.trim() === '') {
      fail(422, 'The PDF has no text (a scan?)', 'pdf_no_text')
    }
  }
  else {
    source = 'text'
    const body = await readBody<{ text?: unknown }>(event)
    text = typeof body?.text === 'string' ? body.text : ''
    if (text.trim() === '') {
      fail(400, 'No text to read', 'rulebook_empty')
    }
    if (text.length > PDF_MAX_CHARS) {
      fail(413, 'The text is too long', 'rulebook_too_long', { max: PDF_MAX_CHARS })
    }
  }

  return { ...importRulebook(useDb(), text), source }
})
