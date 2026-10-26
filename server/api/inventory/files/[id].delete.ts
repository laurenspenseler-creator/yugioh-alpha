import { createError, getRouterParam, setResponseStatus } from 'h3'
import { useDb } from '../../../db'
import { deleteInventoryFile } from '../../../utils/inventory-files'
import { requireUser } from '../../../utils/session'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 404, statusMessage: 'File not found', data: { code: 'inventory_file_not_found' } })
  }

  const user = await requireUser(event)
  await deleteInventoryFile(useDb(), user.id, id)
  setResponseStatus(event, 204)
})
