import { createError, getQuery, getRouterParam, sendStream, setResponseHeaders } from 'h3'
import { useDb } from '../../../db'
import { contentDisposition, openInventoryFile } from '../../../utils/inventory-files'
import { requireUser } from '../../../utils/session'

/**
 * Opens or downloads one of the user's inventory files (ADR 0033). A PDF,
 * image or text file is shown inline; anything else, and every file with
 * `?download=1`, is an attachment. Files are private to their owner.
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 404, statusMessage: 'File not found', data: { code: 'inventory_file_not_found' } })
  }

  const user = await requireUser(event)
  const file = openInventoryFile(useDb(), user.id, id)
  const inline = file.openable && getQuery(event).download === undefined

  setResponseHeaders(event, {
    'content-type': file.contentType,
    'content-length': file.size,
    'content-disposition': contentDisposition(inline ? 'inline' : 'attachment', file.name),
    'cache-control': 'private, no-store',
    'x-content-type-options': 'nosniff',
    // Images and text can't need anything from the app; a PDF is left alone
    // because a sandboxing policy stops the browser's own PDF viewer.
    ...(inline && file.contentType !== 'application/pdf' ? { 'content-security-policy': `default-src 'none'; style-src 'unsafe-inline'; sandbox` } : {}),
  })

  return sendStream(event, file.stream)
})
