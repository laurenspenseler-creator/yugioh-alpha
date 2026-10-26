import { createError, getRequestHeader, readMultipartFormData, setResponseStatus } from 'h3'
import { useDb } from '../../../db'
import { saveInventoryFiles } from '../../../utils/inventory-files'
import { requireUser } from '../../../utils/session'
import { INVENTORY_FILE_MAX_BYTES, INVENTORY_FILE_MAX_PER_UPLOAD } from '../../../../shared/inventory-files'

// Room for the multipart framing around the files themselves.
const BODY_OVERHEAD_BYTES = 1024 * 1024

/**
 * Stores one or more files (multipart field `file`) in the user's inventory
 * (ADR 0033). The declared body size is checked before anything is read, so an
 * oversized upload is refused instead of buffered.
 */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)

  const declared = Number(getRequestHeader(event, 'content-length') ?? 0)
  if (declared > INVENTORY_FILE_MAX_BYTES * INVENTORY_FILE_MAX_PER_UPLOAD + BODY_OVERHEAD_BYTES) {
    throw createError({
      statusCode: 413,
      statusMessage: 'The upload is too large',
      data: { code: 'inventory_file_too_large', params: { max: INVENTORY_FILE_MAX_BYTES / (1024 * 1024) } },
    })
  }

  const parts = (await readMultipartFormData(event)) ?? []
  const files = parts
    .filter(part => part.name === 'file' && part.filename !== undefined)
    .map(part => ({ filename: part.filename, data: part.data }))

  const created = await saveInventoryFiles(useDb(), user.id, files)
  setResponseStatus(event, 201)
  return { items: created }
})
