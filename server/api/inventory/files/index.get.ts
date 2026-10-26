import { useDb } from '../../../db'
import { listInventoryFiles } from '../../../utils/inventory-files'
import { requireUser } from '../../../utils/session'

/** The signed-in user's inventory files (ADR 0033), newest first. */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  return listInventoryFiles(useDb(), user.id)
})
