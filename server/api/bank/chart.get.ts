import { defineEventHandler } from 'nitro/h3'
import { requireUserId } from '#server/utils/auth'
import { getBankChartHistory } from '#server/utils/bank'

export default defineEventHandler(async (event) => {
  const userId = await requireUserId(event)

  return getBankChartHistory(userId)
})
